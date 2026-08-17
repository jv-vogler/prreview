import type { Anchor } from "../domain/anchor/Anchor";
import { type ReanchorResult, reanchor } from "../domain/anchor/reanchor";
import type { StoredAnnotation } from "../domain/annotation/Annotation";
import {
	type AnnotationTriage,
	type DeltaHunkSets,
	triageAnnotations,
} from "../domain/annotation/triageAnnotations";
import type { FileDiff } from "../domain/changeset/FileDiff";
import { buildLineIndex, type LineIndex } from "../domain/changeset/LineIndex";
import { type BlobReaders, readBlobLines } from "./blobContent";

export interface ReanchorAnnotationsInput {
	annotations: readonly StoredAnnotation[];
	/** the round the annotations were made against */
	previousFiles: readonly FileDiff[];
	/** the round they have to survive into */
	nextFiles: readonly FileDiff[];
}

/**
 * Re-anchoring one round's annotations onto the next (ARCHITECTURE §6, §12,
 * REQ-006). In plain terms: the code moved, so every note is looked up again in
 * the new state — kept where it still lands, flagged when the edit touched it,
 * and retired when the lines it described are gone.
 *
 * This function is the impure half: it resolves renames, reads both sides'
 * blobs, and computes the hunkId arithmetic. The judgment itself is the
 * domain's — `reanchor` decides where an anchor landed, `triageAnnotations`
 * decides what that means.
 */
export async function reanchorAnnotations(
	readers: BlobReaders,
	input: ReanchorAnnotationsInput,
): Promise<AnnotationTriage> {
	if (input.annotations.length === 0) {
		return { carried: [], retired: [] };
	}

	const delta = deltaHunkSets(input.previousFiles, input.nextFiles);
	const lineIndexes = new Map<string, LineIndex>();
	const reanchored = [];

	for (const annotation of input.annotations) {
		const nextFile = findNextFile(input.nextFiles, annotation.anchor);
		if (nextFile === undefined) {
			// the file left the changeset entirely: there is nothing in this round
			// for the note to describe, so triage retires it as orphaned
			reanchored.push({
				annotation,
				reanchor: orphaned(annotation.anchor),
				targetHunkIds: [],
			});
			continue;
		}

		const side = await readSide(readers, nextFile, annotation.anchor.side);
		const previousLines = await readPreviousLines(readers, annotation.anchor);
		if (side === null || previousLines === null) {
			reanchored.push({
				annotation,
				reanchor: orphaned(annotation.anchor),
				targetHunkIds: [],
			});
			continue;
		}

		const lineIndex = cachedLineIndex(lineIndexes, nextFile);
		const result = reanchor({
			anchor: annotation.anchor,
			oldLines: previousLines,
			newFile: {
				fileId: nextFile.id,
				path: pathOnSide(nextFile, annotation.anchor.side),
				blobOid: side.oid,
				lines: side.lines,
			},
			newLineIndex: lineIndex,
		});
		reanchored.push({
			annotation,
			reanchor: result,
			targetHunkIds: targetHunkIds(result.anchor, lineIndex),
		});
	}

	return triageAnnotations(reanchored, delta);
}

/** `unchanged = old ∩ new`, `changed = new − old`, `removed = old − new` (§12) */
export function deltaHunkSets(
	previousFiles: readonly FileDiff[],
	nextFiles: readonly FileDiff[],
): DeltaHunkSets {
	const previous = hunkIdSet(previousFiles);
	const next = hunkIdSet(nextFiles);
	const unchanged = new Set<string>();
	const changed = new Set<string>();
	const removed = new Set<string>();
	for (const hunkId of next) {
		if (previous.has(hunkId)) {
			unchanged.add(hunkId);
		} else {
			changed.add(hunkId);
		}
	}
	for (const hunkId of previous) {
		if (!next.has(hunkId)) {
			removed.add(hunkId);
		}
	}
	return { unchanged, changed, removed };
}

function hunkIdSet(files: readonly FileDiff[]): Set<string> {
	return new Set(files.flatMap((file) => file.hunks.map((hunk) => hunk.id)));
}

/**
 * The same file in the new round, following a rename in either direction: the
 * anchor's path may be what the file was called before this round renamed it,
 * or what it was called after the previous round already had.
 *
 * Candidates that still have content on the anchored side win, because a
 * rename git did not detect appears as a delete and an add under two paths and
 * the deleted one has no new side to anchor into.
 */
function findNextFile(
	nextFiles: readonly FileDiff[],
	anchor: Anchor,
): FileDiff | undefined {
	const candidates = nextFiles.filter(
		(file) =>
			pathOnSide(file, anchor.side) === anchor.path ||
			file.path === anchor.path ||
			file.oldPath === anchor.path,
	);
	return (
		candidates.find(
			(file) => hasSide(file, anchor.side) && pathMatchesSide(file, anchor),
		) ??
		candidates.find((file) => hasSide(file, anchor.side)) ??
		candidates[0]
	);
}

function pathMatchesSide(file: FileDiff, anchor: Anchor): boolean {
	return pathOnSide(file, anchor.side) === anchor.path;
}

function hasSide(file: FileDiff, side: Anchor["side"]): boolean {
	return (side === "old" ? file.oldBlob : file.newBlob) !== null;
}

function pathOnSide(file: FileDiff, side: Anchor["side"]): string {
	return side === "old" ? (file.oldPath ?? file.path) : file.path;
}

async function readSide(
	readers: BlobReaders,
	file: FileDiff,
	side: Anchor["side"],
): Promise<{ oid: string; lines: string[] } | null> {
	const ref = side === "old" ? file.oldBlob : file.newBlob;
	if (ref === null) {
		return null;
	}
	return readBlobLines(readers, {
		ref,
		workingPath: pathOnSide(file, side),
	});
}

/**
 * The anchored side as it was: read by the snapshot's oid, because the snapshot
 * itself stores normalized lines and re-anchoring needs the raw ones (the
 * `.prreview/blobs/` copy is what makes this work after a worktree moved on).
 */
async function readPreviousLines(
	readers: BlobReaders,
	anchor: Anchor,
): Promise<string[] | null> {
	const previous = await readBlobLines(readers, {
		ref: { kind: "odb", oid: anchor.snapshot.blobOid },
	});
	return previous === null ? null : previous.lines;
}

function cachedLineIndex(
	cache: Map<string, LineIndex>,
	file: FileDiff,
): LineIndex {
	const cached = cache.get(file.id);
	if (cached !== undefined) {
		return cached;
	}
	const built = buildLineIndex(file);
	cache.set(file.id, built);
	return built;
}

/** every hunk the landed target overlaps in the new round */
function targetHunkIds(anchor: Anchor, lineIndex: LineIndex): string[] {
	if (anchor.placement === "file-level") {
		return [];
	}
	const sideLines =
		anchor.side === "old" ? lineIndex.oldLines : lineIndex.newLines;
	const hunkIds = new Set<string>();
	for (let line = anchor.startLine; line <= anchor.endLine; line++) {
		const hunkId = sideLines.get(line);
		if (hunkId !== undefined) {
			hunkIds.add(hunkId);
		}
	}
	return [...hunkIds];
}

function orphaned(anchor: Anchor): ReanchorResult {
	return { anchor, status: "orphaned", touchedByDelta: false };
}
