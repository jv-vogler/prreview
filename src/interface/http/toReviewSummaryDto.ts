import type { RoundReview } from "../../application/review/RoundReview";
import type {
	DiscardGroupDto,
	DiscardReasonKindDto,
	ReviewSummaryDto,
} from "./dto/ReviewSummaryDto";

/** how many titles a group carries; the rest are counted, not listed */
const MAX_EXAMPLES = 5;

/** most consequential first, so the reader meets the hardest cut at the top */
const REASON_ORDER: DiscardReasonKindDto[] = [
	"ungrounded-blocker",
	"form",
	"below-confidence-floor",
];

/**
 * The round's review record as the comments tab reads it: grouped by reason,
 * counted, with a few titles per group.
 *
 * Grouping happens here rather than in the client because the count is a fact
 * about the run and the client is not allowed to re-derive facts the server
 * already knows (§9) — the same rule that keeps coverage percentages
 * server-side.
 */
export function toReviewSummaryDto(review: RoundReview): ReviewSummaryDto {
	const byReason = new Map<DiscardReasonKindDto, DiscardGroupDto>();
	for (const candidate of review.discarded) {
		const kind = candidate.reason.kind;
		const group = byReason.get(kind);
		if (group === undefined) {
			byReason.set(kind, {
				reason: kind,
				count: 1,
				examples: [candidate.title],
			});
			continue;
		}
		group.count += 1;
		if (group.examples.length < MAX_EXAMPLES) {
			group.examples.push(candidate.title);
		}
	}

	return {
		discardedTotal: review.discarded.length,
		discarded: [...byReason.values()].sort(
			(left, right) =>
				REASON_ORDER.indexOf(left.reason) - REASON_ORDER.indexOf(right.reason),
		),
		skippedAnchors: review.skippedAnchors,
	};
}
