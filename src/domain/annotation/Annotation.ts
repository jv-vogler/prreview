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
}

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
	confidence?: "high" | "medium" | "low";
	citations?: Citation[];
	groundingVerified?: boolean;
	suggestedFix?: string;
	curation?: AnnotationCuration;
	resolution?: AnnotationResolution;
	publish?: AnnotationPublish;
}
