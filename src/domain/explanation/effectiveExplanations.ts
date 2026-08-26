import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { CommentPlacement } from "../changeset/placeComment";
import { placeComment } from "../changeset/placeComment";
import type { StoredReview } from "../pass/StoredReview";

/**
 * One explanation with its spot on the rendered diff resolved, through the
 * same `placeComment` contract findings use — never a fork of it. An
 * unplaceable explanation is still returned, placement and all: the diff
 * view drops it, but it reaches the wire so it is never silently lost.
 */
export interface EffectiveExplanation {
	id: string;
	path: string;
	startLine: number;
	endLine: number;
	says: string[];
	topic?: string;
	placement: CommentPlacement;
}

/**
 * Positional like `reviewCommentId`: nothing ever reorders or removes an
 * explanation for the life of a pass, so its index is a stable identity.
 */
export function explanationId(index: number): string {
	return `explanation-${index}`;
}

export function effectiveExplanations(
	stored: StoredReview,
	files: readonly FileDiff[],
): EffectiveExplanation[] {
	return stored.pass.explanations.map((explanation, index) => ({
		id: explanationId(index),
		path: explanation.path,
		startLine: explanation.startLine,
		endLine: explanation.endLine,
		says: explanation.says,
		...(explanation.topic === undefined ? {} : { topic: explanation.topic }),
		placement: placeComment(
			{
				path: explanation.path,
				startLine: explanation.startLine,
				endLine: explanation.endLine,
			},
			files,
		),
	}));
}
