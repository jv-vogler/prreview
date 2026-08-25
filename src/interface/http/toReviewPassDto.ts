import type { StoredReview } from "../../application/ports/SessionStore";
import type { EffectiveComment } from "../../application/review/effectiveComments";
import { effectiveComments } from "../../application/review/effectiveComments";
import type { EffectiveExplanation } from "../../application/review/effectiveExplanations";
import { effectiveExplanations } from "../../application/review/effectiveExplanations";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import type {
	ExplanationDto,
	ReviewCommentDto,
	ReviewPassDto,
} from "./dto/ReviewDto";

/**
 * Turns the persisted pass into the wire shape the client renders
 * (TASK-041): `effectiveComments` already resolved each finding's curation
 * and placement (TASK-046, TASK-050); this is only the DTO mapping.
 */
export function toReviewPassDto(
	stored: StoredReview,
	files: readonly FileDiff[],
): ReviewPassDto {
	const publishedIds = new Set(stored.published?.commentIds ?? []);
	const carriedIds = new Set(stored.carriedFindingIds ?? []);
	return {
		overview: stored.pass.overview,
		verdict: stored.pass.verdict,
		...(stored.pass.scope === undefined ? {} : { scope: stored.pass.scope }),
		ticket: stored.pass.ticket,
		residue: stored.residue,
		published: stored.published,
		comments: effectiveComments(stored, files).map((comment) =>
			toReviewCommentDto(comment, publishedIds, carriedIds),
		),
		explanations: effectiveExplanations(stored, files).map(toExplanationDto),
	};
}

function toExplanationDto(explanation: EffectiveExplanation): ExplanationDto {
	return {
		id: explanation.id,
		path: explanation.path,
		startLine: explanation.startLine,
		endLine: explanation.endLine,
		says: explanation.says,
		...(explanation.topic === undefined ? {} : { topic: explanation.topic }),
		placement: explanation.placement,
	};
}

function toReviewCommentDto(
	comment: EffectiveComment,
	publishedIds: ReadonlySet<string>,
	carriedIds: ReadonlySet<string>,
): ReviewCommentDto {
	return {
		id: comment.id,
		path: comment.path,
		startLine: comment.startLine,
		endLine: comment.endLine,
		kind: comment.kind,
		...(comment.tier === undefined ? {} : { tier: comment.tier }),
		title: comment.title,
		body: comment.body,
		...(comment.evidence === undefined ? {} : { evidence: comment.evidence }),
		proof: comment.proof,
		verified: comment.verified,
		lane: comment.lane,
		placement: comment.placement,
		edited: comment.edited,
		deleted: comment.deleted,
		published: publishedIds.has(comment.id),
		carried: carriedIds.has(comment.id),
	};
}
