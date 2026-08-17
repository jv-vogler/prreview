import type { Annotation } from "./Annotation";
import { annotationIsExplanation } from "./Annotation";

/**
 * How many notes each file carries, for the file panel's count (TASK-057).
 * A count, deliberately — not heat: ranking files by attention needs risk
 * scores, which are F6's and M3's, and a number that looked like a severity
 * would be a claim this milestone cannot back up.
 */
export function countNotesByFileId(
	annotations: readonly Annotation[],
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const annotation of annotations) {
		if (!annotationIsExplanation(annotation)) {
			continue;
		}
		const fileId = annotation.anchor.fileId;
		counts.set(fileId, (counts.get(fileId) ?? 0) + 1);
	}
	return counts;
}
