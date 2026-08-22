import { z } from "zod";

/**
 * The pass artifact and its comments with placements (TASK-041): the wire
 * shape the client renders directly. Mirrors `reviewSchema.ts`'s severity
 * ladder and lane split; it may import nothing but zod (CON-008).
 */

const reviewTierDtoSchema = z.enum([
	"blocker",
	"should-fix",
	"suggestion",
	"nitpick",
]);

export type ReviewTierDto = z.infer<typeof reviewTierDtoSchema>;

const reviewLaneDtoSchema = z.enum(["review", "pre-existing"]);

export type ReviewLaneDto = z.infer<typeof reviewLaneDtoSchema>;

const commentAnchorSideDtoSchema = z.enum(["old", "new"]);

export type CommentAnchorSideDto = z.infer<typeof commentAnchorSideDtoSchema>;

/**
 * Where a comment lands on the rendered diff (REQ-010): `exact` anchors the
 * requested range itself; `clamped` anchors the nearest rendered line
 * instead, carrying the requested range for display; `unplaceable` means the
 * finding cannot be shown on the diff at all — but it must still reach the
 * reader, never be silently dropped.
 */
export const commentPlacementDtoSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("exact"),
		fileId: z.string(),
		side: commentAnchorSideDtoSchema,
		line: z.int().min(1),
	}),
	z.object({
		kind: z.literal("clamped"),
		fileId: z.string(),
		side: commentAnchorSideDtoSchema,
		line: z.int().min(1),
		requestedStartLine: z.int().min(1),
		requestedEndLine: z.int().min(1),
	}),
	z.object({ kind: z.literal("unplaceable") }),
]);

export type CommentPlacementDto = z.infer<typeof commentPlacementDtoSchema>;

export const reviewCommentDtoSchema = z.object({
	id: z.string(),
	path: z.string(),
	startLine: z.int().min(1),
	endLine: z.int().min(1),
	tier: reviewTierDtoSchema,
	title: z.string(),
	body: z.string(),
	evidence: z.string().optional(),
	proof: z.string(),
	verified: z.boolean(),
	lane: reviewLaneDtoSchema,
	placement: commentPlacementDtoSchema,
});

export type ReviewCommentDto = z.infer<typeof reviewCommentDtoSchema>;

/** `GET /api/review`'s `pass` field once a review has completed at least once. */
export const reviewPassDtoSchema = z.object({
	overview: z.string(),
	verdict: z.string(),
	ticket: z.string().nullable(),
	qualityPoints: z.array(z.string()),
	comments: z.array(reviewCommentDtoSchema),
	/** SEC-003/TASK-030's honesty measure: files this pass left on the tree */
	residue: z.array(z.string()),
});

export type ReviewPassDto = z.infer<typeof reviewPassDtoSchema>;
