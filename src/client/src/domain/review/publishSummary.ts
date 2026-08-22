import type { ReviewCommentDto } from "@dto/ReviewDto";

export type PublishExclusionReason = "pre-existing" | "unplaceable";

export interface PublishExclusion {
	comment: ReviewCommentDto;
	reason: PublishExclusionReason;
}

export interface PublishSummary {
	publishable: ReviewCommentDto[];
	excluded: PublishExclusion[];
}

/**
 * Mirrors `publishReview`'s own filter (REQ-010, REQ-011) so the "Send
 * review" control can state, before sending, exactly what will go and what
 * will not (TASK-052) — a client guess that drifted from the server's own
 * rule is the failure mode this exists to avoid.
 */
export function summarizePublish(
	comments: readonly ReviewCommentDto[],
): PublishSummary {
	const publishable: ReviewCommentDto[] = [];
	const excluded: PublishExclusion[] = [];
	for (const comment of comments) {
		if (comment.lane === "pre-existing") {
			excluded.push({ comment, reason: "pre-existing" });
		} else if (comment.placement.kind === "unplaceable") {
			excluded.push({ comment, reason: "unplaceable" });
		} else {
			publishable.push(comment);
		}
	}
	return { publishable, excluded };
}
