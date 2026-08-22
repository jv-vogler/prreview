import type { CommentEdit } from "../ports/SessionStore";
import type { ReviewFinding } from "./reviewSchema";

/**
 * The two questions curation state answers about one finding, pulled out
 * once so `toReviewPassDto` and `reworkComment` read the same overlay rather
 * than each re-deriving it (TASK-046).
 */

/** The body the reader should see: their own edit if there is one, else the engine's. */
export function effectiveBody(
	finding: ReviewFinding,
	edit: CommentEdit | undefined,
): string {
	return edit?.body ?? finding.body;
}

export function isDeleted(edit: CommentEdit | undefined): boolean {
	return edit?.deleted === true;
}
