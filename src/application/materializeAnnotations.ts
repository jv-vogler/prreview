import type { Anchor } from "../domain/anchor/Anchor";
import { captureSnapshot } from "../domain/anchor/captureSnapshot";
import { computePlacement } from "../domain/anchor/computePlacement";
import type {
	AnnotationProvenance,
	StoredAnnotation,
} from "../domain/annotation/Annotation";
import { newAnnotationId } from "../domain/annotation/newAnnotationId";
import type { BlobRef } from "../domain/changeset/BlobRef";
import type { FileDiff } from "../domain/changeset/FileDiff";
import { buildLineIndex } from "../domain/changeset/LineIndex";
import { type BlobLines, type BlobReaders, readBlobLines } from "./blobContent";
import type { SessionStore } from "./ports/SessionStore";

/** `.prreview/blobs/` is content-addressed by full oid; a diff's abbreviated
 * index oid cannot name a file there (a PR diff's oids are abbreviated, and
 * their blobs live in the object database anyway). */
const STORABLE_OID = /^[0-9a-f]{40,64}$/;

export interface MaterializeAnnotationsDeps extends BlobReaders {
	store: Pick<SessionStore, "readBlob" | "writeBlob">;
}

/**
 * What the agent emitted, before the server turns it into a stored annotation:
 * an anchor in printed line numbers plus the text. Declared here rather than
 * imported from a task schema so this use-case serves every producer —
 * findings are the next one — instead of being tied to one pass's contract.
 */
export interface AnnotationDraft {
	anchor: {
		path: string;
		side: "old" | "new";
		startLine: number;
		endLine: number;
	};
	body: string;
	/** the producer's own classification, stored verbatim on the annotation */
	category?: string;
	species?: "explanation" | "finding" | "related-finding";
	title?: string;
	severity?: string;
	/**
	 * Whether every citation resolved against what the round actually read.
	 *
	 * Carried through rather than recomputed here: the check runs once, in
	 * adjudication, against the union of the round's read logs — and a check
	 * whose answer is computed and then dropped is the same as no check at all.
	 */
	groundingVerified?: boolean;
	proof?: { mode: "traced" | "inferred"; how: string };
	confidence?: "high" | "medium" | "low";
	citations?: { path: string; startLine?: number; endLine?: number }[];
}

export interface MaterializeAnnotationsInput {
	drafts: readonly AnnotationDraft[];
	/** the round the agent was shown — the universe of paths and hunkIds */
	files: readonly FileDiff[];
	provenance: AnnotationProvenance;
	/** ISO timestamp; injected so a test can assert the record verbatim */
	createdAt: string;
}

export interface MaterializedAnnotations {
	annotations: StoredAnnotation[];
	/** agent anchors that named nothing placeable and were dropped */
	skippedAnchors: number;
}

/**
 * Turns what the agent emitted into what prreview stores (ARCHITECTURE §6, §7):
 * the model gives a path, a side, and line numbers; prreview resolves the file,
 * reads that side's real text, captures the snapshot an anchor needs to survive
 * later edits, and computes the placement — which the agent is never allowed to
 * supply.
 *
 * An anchor naming an unknown path, an unreadable side, or an empty range is
 * dropped and counted, never placed at line 0: a note in the wrong place is
 * worse than a note that is missing.
 */
export async function materializeAnnotations(
	deps: MaterializeAnnotationsDeps,
	input: MaterializeAnnotationsInput,
): Promise<MaterializedAnnotations> {
	const annotations: StoredAnnotation[] = [];
	let skippedAnchors = 0;
	const sideCache = new Map<string, BlobLines | null>();

	for (const explanation of input.drafts) {
		const { anchor: agentAnchor } = explanation;
		const file = findFile(input.files, agentAnchor.path, agentAnchor.side);
		if (file === undefined) {
			skippedAnchors++;
			continue;
		}
		const side = await readSide(deps, file, agentAnchor.side, sideCache);
		if (side === null) {
			skippedAnchors++;
			continue;
		}
		const range = clampRange(
			agentAnchor.startLine,
			agentAnchor.endLine,
			side.lines.length,
		);
		if (range === null) {
			skippedAnchors++;
			continue;
		}

		const anchor: Anchor = {
			fileId: file.id,
			path: agentAnchor.path,
			side: agentAnchor.side,
			startLine: range.startLine,
			endLine: range.endLine,
			placement: computePlacement({
				side: agentAnchor.side,
				startLine: range.startLine,
				endLine: range.endLine,
				lineIndex: buildLineIndex(file),
				blobLineCount: side.lines.length,
			}),
			snapshot: captureSnapshot(
				side.lines,
				range.startLine,
				range.endLine,
				side.oid,
			),
		};
		annotations.push({
			id: newAnnotationId(),
			species: explanation.species ?? "finding",
			anchor,
			anchorStatus: "anchored",
			body: explanation.body,
			...optional("category", explanation.category),
			...optional("title", explanation.title),
			...optional("severity", explanation.severity),
			...optional("groundingVerified", explanation.groundingVerified),
			...optional("proof", explanation.proof),
			...optional("confidence", explanation.confidence),
			...optional("citations", explanation.citations),
			provenance: input.provenance,
			createdAt: input.createdAt,
		});
	}

	return { annotations, skippedAnchors };
}

/**
 * The agent names a path on a side: the new side is the file's current path,
 * the old side is the path it had before a rename.
 */
function findFile(
	files: readonly FileDiff[],
	path: string,
	side: "old" | "new",
): FileDiff | undefined {
	if (side === "new") {
		return files.find((file) => file.path === path);
	}
	return files.find((file) => (file.oldPath ?? file.path) === path);
}

async function readSide(
	deps: MaterializeAnnotationsDeps,
	file: FileDiff,
	side: "old" | "new",
	cache: Map<string, BlobLines | null>,
): Promise<BlobLines | null> {
	const cacheKey = `${file.id} ${side}`;
	const cached = cache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}
	const lines = await readSideUncached(deps, file, side);
	cache.set(cacheKey, lines);
	return lines;
}

async function readSideUncached(
	deps: MaterializeAnnotationsDeps,
	file: FileDiff,
	side: "old" | "new",
): Promise<BlobLines | null> {
	const ref: BlobRef | null = side === "old" ? file.oldBlob : file.newBlob;
	if (ref === null) {
		return null;
	}
	const workingPath = side === "new" ? file.path : (file.oldPath ?? file.path);
	const lines = await readBlobLines(deps, { ref, workingPath });
	if (lines === null) {
		return null;
	}
	// §11: a worktree side is irreproducible once the code moves on, so it is
	// snapshotted now — that snapshot is what a later round re-anchors against.
	if (lines.fromWorkingTree && STORABLE_OID.test(lines.oid)) {
		await deps.store.writeBlob(lines.oid, lines.content);
	}
	return lines;
}

/**
 * Line numbers come from a language model reading printed numbers: 0/0 is the
 * file-level anchor §6 defines, anything else is clamped into the file and
 * refused when there is nothing to clamp to.
 */
function clampRange(
	startLine: number,
	endLine: number,
	lineCount: number,
): { startLine: number; endLine: number } | null {
	if (startLine === 0 && endLine === 0) {
		return { startLine: 0, endLine: 0 };
	}
	if (lineCount === 0 || startLine < 1 || endLine < startLine) {
		return null;
	}
	const clampedStart = Math.min(startLine, lineCount);
	return {
		startLine: clampedStart,
		endLine: Math.max(clampedStart, Math.min(endLine, lineCount)),
	};
}

/** spreads a field only when it has a value, so `exactOptionalPropertyTypes` holds */
function optional<Key extends string, Value>(
	key: Key,
	value: Value | undefined,
): Record<Key, Value> | Record<string, never> {
	return value === undefined ? {} : ({ [key]: value } as Record<Key, Value>);
}
