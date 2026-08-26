import { z } from "zod";

const reviewTierDtoSchema = z.enum([
	"blocker",
	"should-fix",
	"suggestion",
	"nitpick",
]);

export type ReviewTierDto = z.infer<typeof reviewTierDtoSchema>;

const reviewFindingKindDtoSchema = z.enum(["defect", "question"]);

export type ReviewFindingKindDto = z.infer<typeof reviewFindingKindDtoSchema>;

const reviewLaneDtoSchema = z.enum(["review", "pre-existing"]);

const anchorSideDtoSchema = z.enum(["old", "new"]);

export type AnchorSideDto = z.infer<typeof anchorSideDtoSchema>;

export const findingPlacementDtoSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("exact"),
		fileId: z.string(),
		side: anchorSideDtoSchema,
		line: z.int().min(1),
	}),
	z.object({
		kind: z.literal("clamped"),
		fileId: z.string(),
		side: anchorSideDtoSchema,
		line: z.int().min(1),
		requestedStartLine: z.int().min(1),
		requestedEndLine: z.int().min(1),
	}),
	z.object({ kind: z.literal("unplaceable") }),
]);

export type FindingPlacementDto = z.infer<typeof findingPlacementDtoSchema>;

export const reviewFindingDtoSchema = z.object({
	id: z.string(),
	path: z.string(),
	startLine: z.int().min(1),
	endLine: z.int().min(1),
	kind: reviewFindingKindDtoSchema,

	tier: reviewTierDtoSchema.optional(),
	title: z.string(),
	body: z.string(),
	evidence: z.string().optional(),
	proof: z.string(),
	verified: z.boolean(),
	lane: reviewLaneDtoSchema,
	placement: findingPlacementDtoSchema,

	edited: z.boolean(),

	deleted: z.boolean(),

	published: z.boolean(),

	carried: z.boolean(),
});

export type ReviewFindingDto = z.infer<typeof reviewFindingDtoSchema>;

export const explanationDtoSchema = z.object({
	id: z.string(),
	path: z.string(),
	startLine: z.int().min(1),
	endLine: z.int().min(1),

	says: z.array(z.string()),
	topic: z.string().optional(),
	placement: findingPlacementDtoSchema,
});

export type ExplanationDto = z.infer<typeof explanationDtoSchema>;

export const publishedRecordDtoSchema = z.object({
	reviewId: z.number(),
	htmlUrl: z.string(),
	publishedAt: z.string(),
	findingIds: z.array(z.string()),
});

export type PublishedRecordDto = z.infer<typeof publishedRecordDtoSchema>;

export const reviewScopeDtoSchema = z.enum([
	"matches",
	"misses-pieces",
	"unrelated-extras",
	"no-ticket",
]);

export const reviewPassDtoSchema = z.object({
	overview: z.string(),
	verdict: z.string(),
	scope: reviewScopeDtoSchema.optional(),
	ticket: z.string().nullable(),
	findings: z.array(reviewFindingDtoSchema),

	explanations: z.array(explanationDtoSchema),

	residue: z.array(z.string()),

	published: publishedRecordDtoSchema.nullable(),
});

export type ReviewPassDto = z.infer<typeof reviewPassDtoSchema>;

export const passFreshnessDtoSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("same-commit") }),
	z.object({ kind: z.literal("new-commits"), count: z.int().min(1) }),
	z.object({ kind: z.literal("unknown") }),
]);

export type PassFreshnessDto = z.infer<typeof passFreshnessDtoSchema>;

export const reviewRunRequestDtoSchema = z.object({
	full: z.boolean().optional(),
});

export const editFindingRequestDtoSchema = z.object({
	body: z.string().min(1),
});

export const reworkInstructionDtoSchema = z.enum([
	"concise",
	"expand",
	"explain",
]);

export type ReworkInstructionDto = z.infer<typeof reworkInstructionDtoSchema>;

export const reworkRequestDtoSchema = z.object({
	instruction: reworkInstructionDtoSchema,
});
