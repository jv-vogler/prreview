import type { ReviewFinding } from "../pass/ReviewPass";
import type { FindingEdit } from "../pass/StoredReview";

export function effectiveBody(
	finding: ReviewFinding,
	edit: FindingEdit | undefined,
): string {
	return edit?.body ?? finding.body;
}

export function isDeleted(edit: FindingEdit | undefined): boolean {
	return edit?.deleted === true;
}
