import type { ReviewCommentDto, ReviewTierDto } from "@dto/ReviewDto";

/**
 * How many comments fall in each severity tier, keyed so a caller can pick
 * only the tiers actually present (CommentWorklist's sidebar counts) or read
 * one tier off directly (RunStatusBar's completed take line) without
 * counting the same list twice.
 */
export function countByTier(
	comments: readonly ReviewCommentDto[],
): Record<ReviewTierDto, number> {
	const counts: Record<ReviewTierDto, number> = {
		blocker: 0,
		"should-fix": 0,
		suggestion: 0,
		nitpick: 0,
	};
	for (const comment of comments) {
		counts[comment.tier]++;
	}
	return counts;
}
