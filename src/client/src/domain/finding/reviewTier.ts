import type { ReviewFindingDto, ReviewTierDto } from "@dto/ReviewDto";

export const REVIEW_TIER_ORDER: readonly ReviewTierDto[] = [
	"blocker",
	"should-fix",
	"suggestion",
	"nitpick",
];

export function worstTier(
	findings: readonly ReviewFindingDto[],
): ReviewTierDto | undefined {
	let worst: ReviewTierDto | undefined;
	for (const finding of findings) {
		if (finding.tier === undefined) {
			continue;
		}
		if (
			worst === undefined ||
			REVIEW_TIER_ORDER.indexOf(finding.tier) < REVIEW_TIER_ORDER.indexOf(worst)
		) {
			worst = finding.tier;
		}
	}
	return worst;
}
