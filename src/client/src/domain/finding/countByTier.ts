import type { ReviewFindingDto, ReviewTierDto } from "@dto/ReviewDto";

export function countByTier(
	findings: readonly ReviewFindingDto[],
): Record<ReviewTierDto, number> {
	const counts: Record<ReviewTierDto, number> = {
		blocker: 0,
		"should-fix": 0,
		suggestion: 0,
		nitpick: 0,
	};
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
