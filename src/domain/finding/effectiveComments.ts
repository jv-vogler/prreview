import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { CommentPlacement } from "../changeset/placeComment";
import { placeComment } from "../changeset/placeComment";
import type {
	ReviewFindingKind,
	ReviewLane,
	ReviewTier,
} from "../pass/reviewSchema";
import type { StoredReview } from "../pass/StoredReview";
import { effectiveBody, isDeleted } from "./commentEdits";
import { commentIdAt } from "./reviewCommentId";

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
	kind: ReviewFindingKind;
	/** absent exactly when this is a question */
	tier?: ReviewTier;
	title: string;
	body: string;
	evidence?: string;
	proof: string;
	verified: boolean;
	lane: ReviewLane;
	placement: CommentPlacement;
	/** true once the reader has overwritten `body` (TASK-046) */
	edited: boolean;
	/** dismissed by the reader; still returned so it can be restored */
	deleted: boolean;
}

/** Every finding, including dismissed ones — callers that must exclude those filter themselves. */
export function effectiveComments(
	stored: StoredReview,
	files: readonly FileDiff[],
): EffectiveComment[] {
	return stored.pass.findings.map((finding, index) =>
		toEffectiveComment(finding, index, stored, files),
	);
}

function toEffectiveComment(
	finding: StoredReview["pass"]["findings"][number],
	index: number,
	stored: StoredReview,
	files: readonly FileDiff[],
): EffectiveComment {
	const id = commentIdAt(stored, index);
	const edit = stored.commentEdits[id];
	return {
		id,
		path: finding.path,
		startLine: finding.startLine,
		endLine: finding.endLine,
		kind: finding.kind,
		...(finding.kind === "question" ? {} : { tier: finding.tier }),
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
		deleted: isDeleted(edit),
	};
}
