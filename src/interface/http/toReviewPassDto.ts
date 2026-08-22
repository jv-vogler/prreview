import type {
	CommentEdit,
	StoredReview,
} from "../../application/ports/SessionStore";
import {
	effectiveBody,
	isDeleted,
} from "../../application/review/commentEdits";
import type { ReviewFinding } from "../../application/review/reviewSchema";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { placeComment } from "../../domain/review/placeComment";
import { reviewCommentId } from "../../domain/review/reviewCommentId";
import type { ReviewCommentDto, ReviewPassDto } from "./dto/ReviewDto";

/**
 * Turns the persisted pass into the wire shape the client renders: every
 * finding gets a stable id and a placement against the diff currently on
 * screen (TASK-041), with the reader's own curation (TASK-046) layered on
 * top — a deleted finding never reaches this array at all, rather than
 * arriving tagged for the client to filter out itself.
 */
export function toReviewPassDto(
	stored: StoredReview,
	files: readonly FileDiff[],
): ReviewPassDto {
	return {
		overview: stored.pass.overview,
		verdict: stored.pass.verdict,
		ticket: stored.pass.ticket,
		qualityPoints: stored.pass.qualityPoints,
		residue: stored.residue,
		comments: stored.pass.findings
			.map((finding, index) =>
				toReviewCommentDto(finding, index, stored.commentEdits, files),
			)
			.filter((comment): comment is ReviewCommentDto => comment !== null),
	};
}

function toReviewCommentDto(
	finding: ReviewFinding,
	index: number,
	commentEdits: Record<string, CommentEdit>,
	files: readonly FileDiff[],
): ReviewCommentDto | null {
	const id = reviewCommentId(index);
	const edit = commentEdits[id];
	if (isDeleted(edit)) {
		return null;
	}
	const placement = placeComment(
		{
			path: finding.path,
			startLine: finding.startLine,
			endLine: finding.endLine,
		},
		files,
	);
	return {
		id,
		path: finding.path,
		startLine: finding.startLine,
		endLine: finding.endLine,
		tier: finding.tier,
		title: finding.title,
		body: effectiveBody(finding, edit),
		...(finding.evidence === undefined ? {} : { evidence: finding.evidence }),
		proof: finding.proof,
		verified: finding.verified,
		lane: finding.lane,
		placement,
		edited: edit?.body !== undefined,
	};
}
