import type { Annotation, Finding, RelatedFinding } from "./Annotation";
import { annotationIsExplanation } from "./Annotation";
import type { PierreAnchor } from "./toPierreAnchor";
import { toPierreAnchor } from "./toPierreAnchor";

/**
 * What the diff renders at one spot: a single note, or — for the notes whose
 * code is gone — the file's tray of unattached ones (ARCHITECTURE §6 step 6).
 */
export type AnnotationCard =
	| { kind: "note"; note: Finding | RelatedFinding }
	| { kind: "unanchored"; notes: readonly (Finding | RelatedFinding)[] };

export interface PlacedAnnotation extends PierreAnchor {
	card: AnnotationCard;
}

/** the renderer's convention for "above the first row of the file" */
const FILE_LEVEL_LINE = 0;

/**
 * Group the round's notes by the file they belong to and decide where each one
 * hangs, so the diff wrapper only has to render what this function laid out.
 *
 * An orphaned note is never placed on a line: its code no longer exists, and
 * putting it somewhere plausible would be the one failure mode re-anchoring
 * exists to avoid (RISK-007). Those collapse into one tray per file, at the top
 * of the file.
 *
 * **Explanations are never placed.** Narration belongs beside its code on the
 * Understanding tab, where a reader sees the claim and what it is about at
 * once; scattered through the margin it is the thing this re-model exists to
 * undo. What the margin holds is findings — things you might actually say to
 * the author — and related findings, which look different so the species are
 * told apart at a glance.
 */
export function placeAnnotations(
	annotations: readonly Annotation[],
): Map<string, PlacedAnnotation[]> {
	const byFileId = new Map<string, PlacedAnnotation[]>();
	const orphanedByFileId = new Map<string, (Finding | RelatedFinding)[]>();

	for (const annotation of annotations) {
		if (annotationIsExplanation(annotation)) {
			continue;
		}
		const fileId = annotation.anchor.fileId;
		if (annotation.anchorStatus === "orphaned") {
			appendTo(orphanedByFileId, fileId, annotation);
			continue;
		}
		appendTo(byFileId, fileId, {
			...toPierreAnchor(annotation.anchor),
			card: { kind: "note", note: annotation },
		});
	}

	for (const [fileId, notes] of orphanedByFileId) {
		appendTo(byFileId, fileId, {
			side: "additions",
			lineNumber: FILE_LEVEL_LINE,
			card: { kind: "unanchored", notes },
		});
	}
	return byFileId;
}

function appendTo<Value>(
	target: Map<string, Value[]>,
	key: string,
	value: Value,
): void {
	const existing = target.get(key);
	if (existing === undefined) {
		target.set(key, [value]);
		return;
	}
	existing.push(value);
}
