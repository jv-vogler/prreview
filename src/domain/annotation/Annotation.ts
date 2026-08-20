import type { Anchor, AnchorStatus } from "../anchor/Anchor";

/**
 * Full union per ARCHITECTURE §11; M2 only ever constructs `'explanation'`.
 * Findings and related findings arrive with M3.
 */
export type AnnotationSpecies = "explanation" | "finding" | "related-finding";

/** what an explanation is about, stored in `category` (ARCHITECTURE §7) */
export type ExplanationKind = "intent" | "mechanism" | "implication";

/**
 * A finding's evidence pointer, cross-checked against the run's read log by
 * grounding verification (ARCHITECTURE §7). M3 field, shaped here so the
 * stored record is complete.
 */
export interface Citation {
	path: string;
	startLine?: number;
	endLine?: number;
	/** what the reader should notice there, from the finding's evidence block */
	note?: string;
}

/**
 * Why a finding survived in a weakened form.
 *
 * Structured rather than a stored sentence: the marks are copy a reader sees,
 * and copy that lives in `.prreview/` can never be reworded without rewriting
 * everybody's session files. The client holds the sentences, the same way it
 * holds the run-failure and chat-failure copy tables.
 *
 * A finding with no marks is not hedged. That is different from
 * `groundingVerified: false` with no marks, which is what a reword produces
 * when it loses its stamp without a specific citation to blame.
 */
export type FindingMark =
	| { kind: "ungrounded-citation"; path: string }
	| { kind: "inferred-path" };

export interface AnnotationProvenance {
	roundId: string;
	stage: string;
	engineSessionId: string;
}

export interface AnnotationCuration {
	state: "proposed" | "accepted" | "edited" | "dismissed";
	dismissReason?: string;
	updatedAt: string;
}

export interface AnnotationResolution {
	addressedInRound: string;
	evidence: string;
}

export interface AnnotationPublish {
	githubThreadId?: string;
	publishedAt?: string;
	downgradedToFileLevel?: boolean;
}

/**
 * The persisted annotation record (ARCHITECTURE §11). The fields M2 uses are
 * required; everything curation, grounding, resolution, and publishing needs
 * is optional and unused until M3/M4 — additive optional fields never bump
 * the schema version (CON-012).
 */
export interface StoredAnnotation {
	/** ulid: lexicographic order is creation order */
	id: string;
	species: AnnotationSpecies;
	anchor: Anchor;
	anchorStatus: AnchorStatus;
	body: string;
	provenance: AnnotationProvenance;
	createdAt: string;
	touchedByDelta?: boolean;
	title?: string;
	/** the AI's original, kept when the user edits */
	originalBody?: string;
	/** an ExplanationKind for explanations; a finding category for findings */
	category?: string;
	/** how much a finding matters: blocker | should-fix | consider | nitpick */
	severity?: string;
	/**
	 * How the claim was established, and how. Kept off the body so a publisher
	 * can omit it without editing prose, and marked stale when a rewrite changes
	 * the sentence the proof was about.
	 */
	proof?: { mode: "traced" | "inferred"; how: string; stale?: boolean };
	/** append-only record of every edit, so a rewrite is never a silent swap */
	editTrail?: { at: string; by: "user" | "chat"; previousBody: string }[];
	confidence?: "high" | "medium" | "low";
	citations?: Citation[];
	groundingVerified?: boolean;
	/** the specific hedges adjudication attached, for the card to state honestly */
	marks?: FindingMark[];
	/**
	 * A test that would fail today and pass once this is fixed.
	 *
	 * An artifact, never an execution: prreview cannot run anything, which is
	 * also why `proof.mode` has no `tested` value. A reword does not clear it —
	 * the test is about the code, not about the sentence describing it.
	 */
	reproTest?: string;
	suggestedFix?: string;
	curation?: AnnotationCuration;
	resolution?: AnnotationResolution;
	publish?: AnnotationPublish;
}
