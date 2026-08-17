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
 * The §12 bucket table at the M2 level: `anchored`/`moved` with an untouched
 * target carry silently under the new anchor; `fuzzy`, or a target inside the
 * delta, carries marked `touchedByDelta`; orphaned explanations retire
 * automatically — they are cheap to regenerate. Findings never reach this
 * function in M2 (none exist); it throws on any other species so M3's
 * adjudication buckets have to opt in deliberately.
 */
export function triageAnnotations(
	reanchored: ReanchoredAnnotation[],
	delta: DeltaHunkSets,
): AnnotationTriage {
	const carried: StoredAnnotation[] = [];
	const retired: string[] = [];
	for (const { annotation, reanchor, targetHunkIds } of reanchored) {
		if (annotation.species !== "explanation") {
			throw new Error(
				`triageAnnotations handles only explanations in M2; got species "${annotation.species}" ` +
					`(id ${annotation.id}) — finding adjudication is M3's to wire in deliberately`,
			);
		}
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
