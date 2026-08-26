import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { EffectiveExplanation } from "../../domain/explanation/effectiveExplanations";
import { effectiveExplanations } from "../../domain/explanation/effectiveExplanations";
import type { EffectiveFinding } from "../../domain/finding/effectiveFindings";
import { effectiveFindings } from "../../domain/finding/effectiveFindings";
import type { StoredReview } from "../../domain/pass/StoredReview";
import type {
	ExplanationDto,
	ReviewFindingDto,
	ReviewPassDto,
} from "./dto/ReviewDto";

/**
 * Turns the persisted pass into the wire shape the client renders
 * (TASK-041): `effectiveFindings` already resolved each finding's curation
 * and placement (TASK-046, TASK-050); this is only the DTO mapping.
 */
export function toReviewPassDto(
	stored: StoredReview,
	files: readonly FileDiff[],
): ReviewPassDto {
	const publishedIds = new Set(stored.published?.findingIds ?? []);
	const carriedIds = new Set(stored.carriedFindingIds ?? []);
	return {
		overview: stored.pass.overview,
		verdict: stored.pass.verdict,
		...(stored.pass.scope === undefined ? {} : { scope: stored.pass.scope }),
		ticket: stored.pass.ticket,
		residue: stored.residue,
		published: stored.published,
		findings: effectiveFindings(stored, files).map((finding) =>
			toReviewFindingDto(finding, publishedIds, carriedIds),
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

function toReviewFindingDto(
	finding: EffectiveFinding,
	publishedIds: ReadonlySet<string>,
	carriedIds: ReadonlySet<string>,
): ReviewFindingDto {
	return {
		id: finding.id,
		path: finding.path,
		startLine: finding.startLine,
		endLine: finding.endLine,
		kind: finding.kind,
		...(finding.tier === undefined ? {} : { tier: finding.tier }),
		title: finding.title,
		body: finding.body,
		...(finding.evidence === undefined ? {} : { evidence: finding.evidence }),
		proof: finding.proof,
		verified: finding.verified,
		lane: finding.lane,
		placement: finding.placement,
		edited: finding.edited,
		deleted: finding.deleted,
		published: publishedIds.has(finding.id),
		carried: carriedIds.has(finding.id),
	};
}
