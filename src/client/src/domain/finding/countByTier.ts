import type { ReviewFindingDto, ReviewTierDto } from "@dto/ReviewDto";

/**
 * How many comments fall in each severity tier, keyed so a caller can pick
 * only the tiers actually present (FindingWorklist's sidebar counts) or read
 * one tier off directly (RunStatusBar's completed take line) without
 * counting the same list twice. A question has no tier and is counted by
 * `countQuestions` instead.
 */
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

/**
 * Questions sit outside the ladder, so they are counted apart from it: a
 * sidebar that folded them into a tier would be claiming a badness the
 * question does not have.
 */
export function countQuestions(findings: readonly ReviewFindingDto[]): number {
	return findings.filter((finding) => finding.kind === "question").length;
}
