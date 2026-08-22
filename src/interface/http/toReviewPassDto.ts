import type { StoredReview } from "../../application/ports/SessionStore";
import type { ReviewFinding } from "../../application/review/reviewSchema";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { placeComment } from "../../domain/review/placeComment";
import type { ReviewCommentDto, ReviewPassDto } from "./dto/ReviewDto";

/**
 * Turns the persisted pass into the wire shape the client renders: every
 * finding gets a stable id and a placement against the diff currently on
 * screen (TASK-041). The placement is computed here, not stored, because it
 * depends on the diff the reader has open, not on the pass itself.
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
		comments: stored.pass.findings.map((finding, index) =>
			toReviewCommentDto(finding, index, files),
		),
	};
}

function toReviewCommentDto(
	finding: ReviewFinding,
	index: number,
	files: readonly FileDiff[],
): ReviewCommentDto {
	const placement = placeComment(
		{
			path: finding.path,
			startLine: finding.startLine,
			endLine: finding.endLine,
		},
		files,
	);
	return {
		id: `finding-${index}`,
		path: finding.path,
		startLine: finding.startLine,
		endLine: finding.endLine,
		tier: finding.tier,
		title: finding.title,
		body: finding.body,
		...(finding.evidence === undefined ? {} : { evidence: finding.evidence }),
		proof: finding.proof,
		verified: finding.verified,
		lane: finding.lane,
		placement,
	};
}
