import type { AnchorDto, AnchorStatusDto } from "@dto/AnchorDto";

/** what an explanation is about (ARCHITECTURE §7) */
export type ExplanationKind = "intent" | "mechanism" | "implication";

export const EXPLANATION_KINDS: readonly ExplanationKind[] = [
	"intent",
	"mechanism",
	"implication",
];

interface AnnotationBase {
	id: string;
	anchor: AnchorDto;
	anchorStatus: AnchorStatusDto;
	body: string;
	title: string | null;
	/** the edit that landed in this round touched the anchored lines (§12) */
	touchedByDelta: boolean;
	createdAt: string;
	roundId: string;
}

/**
 * A margin note that explains, and must never read as a review comment (F3).
 * `kind` is `null` when the agent named a category the client does not know —
 * the note still renders, just without its label.
 */
export interface Explanation extends AnnotationBase {
	species: "explanation";
	kind: ExplanationKind | null;
}

/** where a finding sits in the reviewer's triage */
export type CurationState = "proposed" | "accepted" | "edited" | "dismissed";

interface FindingFields {
	category: string | null;
	/** blocker | should-fix | consider | nitpick */
	severity: string | null;
	/** how the claim was established; `stale` once a rewrite changed it */
	proof: { mode: "traced" | "inferred"; how: string; stale: boolean } | null;
	confidence: "high" | "medium" | "low" | null;
	/** absent until the reviewer has touched it: an untouched finding is `proposed` */
	curation: { state: CurationState; dismissReason: string | null } | null;
	/**
	 * Whether every file this finding cites was actually read by the agent.
	 * A checked program property, not a claim — see the grounding cross-check.
	 */
	groundingVerified: boolean | null;
}

/** A candidate review comment about a problem this change introduced. */
export interface Finding extends AnnotationBase, FindingFields {
	species: "finding";
}

/** A problem that predates this change, noticed nearby. Never review feedback. */
export interface RelatedFinding extends AnnotationBase, FindingFields {
	species: "related-finding";
}

/**
 * The three species the UI must tell apart, answered from one field rather
 * than from where a note came from.
 *
 * The distinction is not cosmetic: a finding may be pasted onto someone's pull
 * request, a related finding must never be, and an explanation is never
 * published at all.
 */
export type Annotation = Explanation | Finding | RelatedFinding;

export function annotationIsExplanation(
	annotation: Annotation,
): annotation is Explanation {
	return annotation.species === "explanation";
}
