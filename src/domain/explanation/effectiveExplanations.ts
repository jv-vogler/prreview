import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { FindingPlacement } from "../changeset/placeOnDiff";
import { placeOnDiff } from "../changeset/placeOnDiff";
import type { StoredReview } from "../pass/StoredReview";

export interface EffectiveExplanation {
	id: string;
	path: string;
	startLine: number;
	endLine: number;
	says: string[];
	topic?: string;
	placement: FindingPlacement;
}

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
		placement: placeOnDiff(
			{
				path: explanation.path,
				startLine: explanation.startLine,
				endLine: explanation.endLine,
			},
			files,
		),
	}));
}
