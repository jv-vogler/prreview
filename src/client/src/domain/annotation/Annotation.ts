import type { AnchorDto, AnchorStatusDto } from "@dto/AnchorDto";
import type { FindingMarkDto } from "@dto/AnnotationDto";

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

/**
 * Why a finding survived in a weakened form — the hedge, structured.
 *
 * The sentences live in `view/findings/findingMarkCopy.ts`, not in the store: a
 * mark is copy a reader sees, and copy persisted in `.prreview/` can never be
 * reworded without rewriting everybody's session files.
 */
export type FindingMark = FindingMarkDto;

/** a place a finding points at besides where it sits */
export interface Citation {
	path: string;
	startLine: number | null;
	endLine: number | null;
	note: string | null;
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
	/**
	 * The specific hedges, which the card states instead of generic copy.
	 *
	 * Empty is not the same as `groundingVerified: false` with no marks: the
	 * latter is what a reword produces when it loses its stamp without a
	 * particular citation to blame.
	 */
	marks: FindingMark[];
	/** what it points at besides its anchor */
	citations: Citation[];
	/** a test that would fail today and pass once fixed; nothing runs it */
	reproTest: string | null;
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

/**
 * The species the diff's margin actually renders.
 *
 * Worth its own predicate rather than a negation spelled out at each call site:
 * the file-tree count and the `]`/`[` stops both filtered for **explanations**,
 * which `placeAnnotations` never places, so the badge always read 0 and the
 * keys never landed on a balloon. Two readers of "what is in the margin" that
 * disagreed with the one writer of it.
 */
export function annotationIsInMargin(
	annotation: Annotation,
): annotation is Finding | RelatedFinding {
	return annotation.species !== "explanation";
}
