import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { CommentPlacement } from "../../domain/review/placeComment";
import { placeComment } from "../../domain/review/placeComment";
import { reviewCommentId } from "../../domain/review/reviewCommentId";
import type { StoredReview } from "../ports/SessionStore";
import { effectiveBody, isDeleted } from "./commentEdits";
import type { ReviewLane, ReviewTier } from "./reviewSchema";

/**
 * One finding as curation and placement have left it: the engine's own
 * answer (TASK-031) with the reader's edits layered on top (TASK-046) and
 * its spot on the rendered diff resolved (TASK-040) — the shared read of
 * the artifact that both `toReviewPassDto` (the wire view) and
 * `publishReview` (TASK-050, what actually gets sent to GitHub) build on,
 * so a finding is placed and curated exactly once.
 */
export interface EffectiveComment {
	id: string;
	path: string;
	startLine: number;
	endLine: number;
	tier: ReviewTier;
	title: string;
	body: string;
	evidence?: string;
	proof: string;
	verified: boolean;
	lane: ReviewLane;
	placement: CommentPlacement;
	/** true once the reader has overwritten `body` (TASK-046) */
	edited: boolean;
}

/** A deleted finding is left out entirely, never tagged for the caller to filter. */
export function effectiveComments(
	stored: StoredReview,
	files: readonly FileDiff[],
): EffectiveComment[] {
	return stored.pass.findings
		.map((finding, index) => toEffectiveComment(finding, index, stored, files))
		.filter((comment): comment is EffectiveComment => comment !== null);
}

function toEffectiveComment(
	finding: StoredReview["pass"]["findings"][number],
	index: number,
	stored: StoredReview,
	files: readonly FileDiff[],
): EffectiveComment | null {
	const id = reviewCommentId(index);
	const edit = stored.commentEdits[id];
	if (isDeleted(edit)) {
		return null;
	}
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
		placement: placeComment(
			{
				path: finding.path,
				startLine: finding.startLine,
				endLine: finding.endLine,
			},
			files,
		),
		edited: edit?.body !== undefined,
	};
}
