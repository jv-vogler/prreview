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

/** M3's species. Modelled now so the wire shape needs no change then. */
export interface Finding extends AnnotationBase {
	species: "finding";
	category: string | null;
	confidence: "high" | "medium" | "low" | null;
}

/** M3's species: a problem that predates this change (F3, F5). */
export interface RelatedFinding extends AnnotationBase {
	species: "related-finding";
	category: string | null;
	confidence: "high" | "medium" | "low" | null;
}

/**
 * The three species the UI must tell apart. M2 only ever receives
 * explanations; the union exists because "is this an explanation or a finding?"
 * is the question that decides how a note looks, and it is answered from one
 * field rather than from where the note came from.
 */
export type Annotation = Explanation | Finding | RelatedFinding;

export function annotationIsExplanation(
	annotation: Annotation,
): annotation is Explanation {
	return annotation.species === "explanation";
}
