import type { ReanchorResult } from "../anchor/reanchor";
import type { StoredAnnotation } from "./Annotation";

export interface ReanchoredAnnotation {
	annotation: StoredAnnotation;
	reanchor: ReanchorResult;
	/**
	 * hunkIds the re-landed target overlaps in the new round, resolved by the
	 * caller from the landed anchor and that file's LineIndex; empty when
	 * orphaned or file-level.
	 */
	targetHunkIds: string[];
}

/** hunkId set arithmetic between two rounds (ARCHITECTURE §12) */
export interface DeltaHunkSets {
	/** old ∩ new */
	unchanged: Set<string>;
	/** new − old */
	changed: Set<string>;
	/** old − new */
	removed: Set<string>;
}

export interface AnnotationTriage {
	carried: StoredAnnotation[];
	retired: string[];
}

/**
 * The §12 bucket table: `anchored`/`moved` with an untouched target carry
 * silently under the new anchor; `fuzzy`, or a target inside the delta, carries
 * marked `touchedByDelta`; an orphaned annotation retires.
 *
 * Findings and explanations are triaged the same way, and the asymmetry that
 * used to justify separating them is gone: explanations no longer survive a
 * round at all — they are narration attached to a topic, regenerated whole by
 * the next comprehension pass. What reaches this function is a finding, whose
 * anchor is the whole point of it, so carrying it correctly across a moved tree
 * is the behavior that matters.
 *
 * `touchedByDelta` is the honest hedge: the annotation still points somewhere
 * real, but the code under it changed since the claim was made, so a surface
 * showing it must say so rather than present it as freshly true.
 */
export function triageAnnotations(
	reanchored: ReanchoredAnnotation[],
	delta: DeltaHunkSets,
): AnnotationTriage {
	const carried: StoredAnnotation[] = [];
	const retired: string[] = [];
	for (const { annotation, reanchor, targetHunkIds } of reanchored) {
		if (reanchor.status === "orphaned") {
			retired.push(annotation.id);
			continue;
		}
		const targetInsideDelta = targetHunkIds.some((hunkId) =>
			delta.changed.has(hunkId),
		);
		const touched = reanchor.touchedByDelta || targetInsideDelta;
		carried.push({
			...annotation,
			anchor: reanchor.anchor,
			anchorStatus: reanchor.status,
			touchedByDelta: touched ? true : undefined,
		});
	}
	return { carried, retired };
}
