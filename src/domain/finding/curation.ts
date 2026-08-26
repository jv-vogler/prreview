import type { ReviewFinding } from "../pass/reviewSchema";
import type { FindingEdit } from "../pass/StoredReview";

/**
 * The two questions curation state answers about one finding, pulled out
 * once so `toReviewPassDto` and `reworkFinding` read the same overlay rather
 * than each re-deriving it (TASK-046).
 */

/** The body the reader should see: their own edit if there is one, else the engine's. */
export function effectiveBody(
	finding: ReviewFinding,
	edit: FindingEdit | undefined,
): string {
	return edit?.body ?? finding.body;
}

export function isDeleted(edit: FindingEdit | undefined): boolean {
	return edit?.deleted === true;
}
