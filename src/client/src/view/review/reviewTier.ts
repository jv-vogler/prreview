import type { ReviewTierDto } from "@dto/ReviewDto";

/**
 * The four severity tiers, in the order the prompt's own table lists them
 * (reviewPrompt.ts's `## Severity`) — worst first, which is also the order
 * the sidebar counts and lists them in.
 */
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

/** the GitHub alert type each tier maps to, per reviewPrompt.ts's severity table */
export const REVIEW_TIER_ALERT_LABEL: Record<ReviewTierDto, string> = {
	blocker: "CAUTION",
	"should-fix": "WARNING",
	suggestion: "TIP",
	nitpick: "NOTE",
};
