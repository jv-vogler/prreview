import type { StoredReview } from "../../application/ports/SessionStore";
import type { EffectiveComment } from "../../application/review/effectiveComments";
import { effectiveComments } from "../../application/review/effectiveComments";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { ReviewCommentDto, ReviewPassDto } from "./dto/ReviewDto";

/**
 * Turns the persisted pass into the wire shape the client renders
 * (TASK-041): `effectiveComments` already resolved each finding's curation
 * and placement (TASK-046, TASK-050); this is only the DTO mapping.
 */
export function toReviewPassDto(
	stored: StoredReview,
	files: readonly FileDiff[],
): ReviewPassDto {
	return {
		overview: stored.pass.overview,
		verdict: stored.pass.verdict,
		ticket: stored.pass.ticket,
		residue: stored.residue,
		published: stored.published,
		comments: effectiveComments(stored, files).map(toReviewCommentDto),
	};
}

function toReviewCommentDto(comment: EffectiveComment): ReviewCommentDto {
	return {
		id: comment.id,
		path: comment.path,
		startLine: comment.startLine,
		endLine: comment.endLine,
		tier: comment.tier,
		title: comment.title,
		body: comment.body,
		...(comment.evidence === undefined ? {} : { evidence: comment.evidence }),
		proof: comment.proof,
		verified: comment.verified,
		lane: comment.lane,
		placement: comment.placement,
		edited: comment.edited,
		deleted: comment.deleted,
	};
}
