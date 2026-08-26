import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { DiffPlacement } from "../changeset/placeOnDiff";
import { placeOnDiff } from "../changeset/placeOnDiff";
import type {
	ReviewFindingKind,
	ReviewLane,
	ReviewTier,
} from "../pass/ReviewPass";
import type { StoredReview } from "../pass/StoredReview";
import { effectiveBody, isDeleted } from "./curation";
import { findingIdAt } from "./findingId";

export interface EffectiveFinding {
	id: string;
	path: string;
	startLine: number;
	endLine: number;
	kind: ReviewFindingKind;
	tier?: ReviewTier;
	title: string;
	body: string;
	evidence?: string;
	proof: string;
	verified: boolean;
	lane: ReviewLane;
	placement: DiffPlacement;
	edited: boolean;
	deleted: boolean;
}

export function effectiveFindings(
	stored: StoredReview,
	files: readonly FileDiff[],
): EffectiveFinding[] {
	return stored.pass.findings.map((finding, index) =>
		toEffectiveFinding(finding, index, stored, files),
	);
}

function toEffectiveFinding(
	finding: StoredReview["pass"]["findings"][number],
	index: number,
	stored: StoredReview,
	files: readonly FileDiff[],
): EffectiveFinding {
	const id = findingIdAt(stored, index);
	const edit = stored.findingEdits[id];
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
		placement: placeOnDiff(
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
