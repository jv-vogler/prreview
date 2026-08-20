import type { Annotation } from "./Annotation";
import { annotationIsInMargin } from "./Annotation";

/**
 * How many notes each file carries, for the file panel's count (TASK-057).
 * A count, deliberately — not heat: ranking files by attention needs risk
 * scores, which are F6's and M3's, and a number that looked like a severity
 * would be a claim this milestone cannot back up.
 *
 * It counts what the margin renders. It used to count explanations, which the
 * margin never shows, so the badge read 0 next to a file carrying four
 * findings.
 */
export function countNotesByFileId(
	annotations: readonly Annotation[],
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const annotation of annotations) {
		if (!annotationIsInMargin(annotation)) {
			continue;
		}
		const fileId = annotation.anchor.fileId;
		counts.set(fileId, (counts.get(fileId) ?? 0) + 1);
	}
	return counts;
}
