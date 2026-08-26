import type { ReviewFindingKindDto, ReviewTierDto } from "@dto/ReviewDto";

export const REVIEW_TIER_ORDER: readonly ReviewTierDto[] = [
	"blocker",
	"should-fix",
	"suggestion",
	"nitpick",
];

export const REVIEW_TIER_LABEL: Record<ReviewTierDto, string> = {
	blocker: "Blocker",
	"should-fix": "Should fix",
	suggestion: "Suggestion",
	nitpick: "Nitpick",
};

const REVIEW_QUESTION_LABEL = "Question";

const REVIEW_UNTIERED_LABEL = "Finding";

export function findingTierLabel(finding: {
	kind: ReviewFindingKindDto;
	tier?: ReviewTierDto;
}): string {
	if (finding.kind === "question") {
		return REVIEW_QUESTION_LABEL;
	}
	return finding.tier === undefined
		? REVIEW_UNTIERED_LABEL
		: REVIEW_TIER_LABEL[finding.tier];
}
