import { z } from "zod";
import { anchorDtoSchema, anchorStatusDtoSchema } from "./AnchorDto";

const annotationProvenanceDtoSchema = z.object({
	roundId: z.string(),
	stage: z.string(),
	engineSessionId: z.string(),
});

const citationDtoSchema = z.object({
	path: z.string(),
	startLine: z.int().min(0).optional(),
	endLine: z.int().min(0).optional(),
});

const annotationCurationDtoSchema = z.object({
	state: z.enum(["proposed", "accepted", "edited", "dismissed"]),
	dismissReason: z.string().optional(),
	updatedAt: z.string(),
});

const annotationResolutionDtoSchema = z.object({
	addressedInRound: z.string(),
	evidence: z.string(),
});

const annotationPublishDtoSchema = z.object({
	githubThreadId: z.string().optional(),
	publishedAt: z.string().optional(),
	downgradedToFileLevel: z.boolean().optional(),
});

/**
 * One annotation on the wire (ARCHITECTURE §11 minus the anchor snapshot).
 * The fields M2 uses are required; everything curation, grounding, resolution,
 * and publishing needs is optional and never sent in this milestone, so the
 * client can model the full shape once and M3 adds no wire change.
 *
 * `species` carries the full union even though M2 only ever produces
 * `explanation` — an explanation must be visually unmistakable from a review
 * comment (F3), and the client decides that from this field.
 */
export const annotationDtoSchema = z.object({
	id: z.string(),
	species: z.enum(["explanation", "finding", "related-finding"]),
	anchor: anchorDtoSchema,
	anchorStatus: anchorStatusDtoSchema,
	body: z.string(),
	provenance: annotationProvenanceDtoSchema,
	createdAt: z.string(),
	/** the edit that landed in this round touched the anchored lines (§12) */
	touchedByDelta: z.boolean().optional(),
	title: z.string().optional(),
	originalBody: z.string().optional(),
	/** an explanation kind (intent/mechanism/implication) or a finding category */
	category: z.string().optional(),
	confidence: z.enum(["high", "medium", "low"]).optional(),
	/** how much a finding matters: blocker | should-fix | consider | nitpick */
	severity: z.string().optional(),
	/**
	 * How the claim was established. `traced` means the path was followed end to
	 * end through code the agent read; `inferred` means a step rests on
	 * something unverified. There is no mode implying execution — prreview
	 * cannot run anything, and a word suggesting otherwise would mislead.
	 *
	 * `stale` is set when a rewrite changed the sentence the proof was about.
	 */
	proof: z
		.object({
			mode: z.enum(["traced", "inferred"]),
			how: z.string(),
			stale: z.boolean().optional(),
		})
		.optional(),
	citations: z.array(citationDtoSchema).optional(),
	/** whether every citation resolved against what the round actually read */
	groundingVerified: z.boolean().optional(),
	suggestedFix: z.string().optional(),
	curation: annotationCurationDtoSchema.optional(),
	resolution: annotationResolutionDtoSchema.optional(),
	publish: annotationPublishDtoSchema.optional(),
});

export type AnnotationDto = z.infer<typeof annotationDtoSchema>;
