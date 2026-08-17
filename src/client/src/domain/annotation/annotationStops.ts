import type { FileDiffDto } from "@dto/ChangesetDto";
import type { Annotation } from "./Annotation";
import { annotationIsExplanation } from "./Annotation";

/** a cursor position that carries at least one note */
export interface AnnotationStop {
	fileIndex: number;
	hunkIndex: number;
	noteCount: number;
}

export type StopDirection = "next" | "previous";

const FIRST_HUNK = 0;

/**
 * Every place `]` and `[` can land, in reading order: files in the order they
 * are rendered, hunks in file order. Several notes on the same hunk are one
 * stop — the cursor cannot be more precise than a hunk, and pressing `]` twice
 * without moving would read as a broken key.
 */
export function annotationStops(
	annotations: readonly Annotation[],
	files: readonly FileDiffDto[],
): AnnotationStop[] {
	const noteCountByPosition = new Map<string, AnnotationStop>();
	for (const annotation of annotations) {
		if (!annotationIsExplanation(annotation)) {
			continue;
		}
		const fileIndex = files.findIndex(
			(file) => file.id === annotation.anchor.fileId,
		);
		if (fileIndex === -1) {
			continue;
		}
		const file = files[fileIndex];
		if (file === undefined || file.hunks.length === 0) {
			continue;
		}
		const hunkIndex = hunkIndexFor(file, annotation);
		const key = `${fileIndex}:${hunkIndex}`;
		const known = noteCountByPosition.get(key);
		if (known === undefined) {
			noteCountByPosition.set(key, { fileIndex, hunkIndex, noteCount: 1 });
			continue;
		}
		known.noteCount += 1;
	}
	return [...noteCountByPosition.values()].sort(
		(left, right) =>
			left.fileIndex - right.fileIndex || left.hunkIndex - right.hunkIndex,
	);
}

/**
 * The next stop after the cursor, or null when there is none in that direction.
 * Deliberately does not wrap: neither does `j`/`k`, and a silent jump back to
 * the top of a long diff is disorienting.
 */
export function nextAnnotationStop(
	stops: readonly AnnotationStop[],
	cursor: { fileIndex: number; hunkIndex: number },
	direction: StopDirection,
): AnnotationStop | null {
	if (direction === "next") {
		return stops.find((stop) => isAfter(stop, cursor)) ?? null;
	}
	return [...stops].reverse().find((stop) => isAfter(cursor, stop)) ?? null;
}

function isAfter(
	stop: { fileIndex: number; hunkIndex: number },
	reference: { fileIndex: number; hunkIndex: number },
): boolean {
	if (stop.fileIndex !== reference.fileIndex) {
		return stop.fileIndex > reference.fileIndex;
	}
	return stop.hunkIndex > reference.hunkIndex;
}

/**
 * Which hunk a note sits in: the one whose rows include the anchored line on
 * the anchored side. A note anchored outside every hunk (an `in-file` or
 * `file-level` anchor) belongs to the file rather than to a hunk, and the
 * file's first hunk is where the reader arrives when they jump to the file.
 */
function hunkIndexFor(file: FileDiffDto, annotation: Annotation): number {
	const { side, endLine, placement } = annotation.anchor;
	if (placement !== "in-diff") {
		return FIRST_HUNK;
	}
	const index = file.hunks.findIndex((hunk) =>
		hunk.lines.some((line) =>
			side === "old" ? line.oldLine === endLine : line.newLine === endLine,
		),
	);
	return index === -1 ? FIRST_HUNK : index;
}
