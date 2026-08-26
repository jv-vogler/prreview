import type { ReviewFindingDto, ReviewTierDto } from "@dto/ReviewDto";
import { REVIEW_TIER_ORDER } from "./reviewTier";

export function countByTier(
	findings: readonly ReviewFindingDto[],
): Record<ReviewTierDto, number> {
	const counts = Object.fromEntries(
		REVIEW_TIER_ORDER.map((tier) => [tier, 0]),
	) as Record<ReviewTierDto, number>;
	for (const finding of findings) {
		if (finding.tier !== undefined) {
			counts[finding.tier]++;
		}
	}
	return counts;
}

export function countQuestions(findings: readonly ReviewFindingDto[]): number {
	return findings.filter((finding) => finding.kind === "question").length;
}

export function allQuestions(findings: readonly ReviewFindingDto[]): boolean {
	return findings.every((finding) => finding.kind === "question");
}
