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
	/** true once the reader has overwritten `body` (TASK-046) */
	edited: z.boolean(),
	/** dismissed, not published — but still shown, so a restore is possible */
	deleted: z.boolean(),
	/** part of the pending review the last publish sent to GitHub (TASK-053) */
	published: z.boolean(),
});

export type ReviewCommentDto = z.infer<typeof reviewCommentDtoSchema>;

/**
 * One authored account of a change, anchored like a comment but never one:
 * the author's voice on what a change does and why, never review feedback,
 * never publishable. Explanations sharing a `topic` label form one topic.
 */
export const explanationDtoSchema = z.object({
	id: z.string(),
	path: z.string(),
	startLine: z.int().min(1),
	endLine: z.int().min(1),
	/** one sentence per entry */
	says: z.array(z.string()),
	topic: z.string().optional(),
	placement: commentPlacementDtoSchema,
});

export type ExplanationDto = z.infer<typeof explanationDtoSchema>;

/** What `publishReview` (TASK-050, TASK-053) left behind, once published. */
export const publishedRecordDtoSchema = z.object({
	reviewId: z.number(),
	htmlUrl: z.string(),
	publishedAt: z.string(),
	commentIds: z.array(z.string()),
});

export type PublishedRecordDto = z.infer<typeof publishedRecordDtoSchema>;

/**
 * The scope check's outcome: how the verdict line should be read (and
 * colored). Absent on passes written before the field existed — neutral.
 */
export const reviewScopeDtoSchema = z.enum([
	"matches",
	"misses-pieces",
	"unrelated-extras",
	"no-ticket",
]);

export type ReviewScopeDto = z.infer<typeof reviewScopeDtoSchema>;

/** `GET /api/review`'s `pass` field once a review has completed at least once. */
export const reviewPassDtoSchema = z.object({
	overview: z.string(),
	verdict: z.string(),
	scope: reviewScopeDtoSchema.optional(),
	ticket: z.string().nullable(),
	comments: z.array(reviewCommentDtoSchema),
	/** the pass's change explanations, placed or not (unplaceable ones carry it in `placement`) */
	explanations: z.array(explanationDtoSchema),
	/** SEC-003/TASK-030's honesty measure: files this pass left on the tree */
	residue: z.array(z.string()),
	/** null until this pass has been published as a pending review at least once */
	published: publishedRecordDtoSchema.nullable(),
});

export type ReviewPassDto = z.infer<typeof reviewPassDtoSchema>;

/**
 * How the stored pass relates to the changeset being served: reviewed at
 * this very commit, N commits behind it, or not comparable (a worktree
 * changeset, an older artifact, a rewritten history). Stated facts only —
 * what the "review again" confirmation may claim.
 */
export const passFreshnessDtoSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("same-commit") }),
	z.object({ kind: z.literal("new-commits"), count: z.int().min(1) }),
	z.object({ kind: z.literal("unknown") }),
]);

export type PassFreshnessDto = z.infer<typeof passFreshnessDtoSchema>;

/** `PATCH /api/review/comments/:id`'s request body (TASK-046, TASK-047). */
export const editCommentRequestDtoSchema = z.object({
	body: z.string().min(1),
});

export type EditCommentRequestDto = z.infer<typeof editCommentRequestDtoSchema>;

/** What the reader can ask a rework for (TASK-048) — see `reworkComment.ts`. */
export const reworkInstructionDtoSchema = z.enum([
	"concise",
	"expand",
	"explain",
]);

export type ReworkInstructionDto = z.infer<typeof reworkInstructionDtoSchema>;

/** `POST /api/review/comments/:id/rework`'s request body. */
export const reworkRequestDtoSchema = z.object({
	instruction: reworkInstructionDtoSchema,
});

export type ReworkRequestDto = z.infer<typeof reworkRequestDtoSchema>;
