import { z } from "zod";

/**
 * `POST /api/analysis` (ARCHITECTURE §8): one endpoint for every task type, so
 * queueing, cancelling, and status semantics exist once.
 *
 * `comprehension` fills the Overview and Understanding tabs; `review` fills the
 * Suggested comments tab. They are **separate tasks on purpose**: reading about
 * a change must never quietly spend on a review nobody asked for, so nothing
 * chains one off the other.
 */

const reviewLensSchema = z.enum([
	"correctness",
	"security",
	"edge-cases",
	"design",
	"fresh-eyes",
	"impact",
]);

/**
 * How hard to look. `custom` carries its own lens list, but `correctness` and
 * `security` are re-applied server-side regardless of what arrives here — a
 * disabled checkbox is not a security control.
 */
/**
 * `custom` stays reachable by the schema and unreachable by the UI, which is
 * the right way round: the lens locks are applied where the depth is built, so
 * a caller asking for a review without the security lens gets one anyway.
 */
export const reviewPresetDtoSchema = z.enum([
	"light",
	"standard",
	"thorough",
	"custom",
]);

export type ReviewPresetDto = z.infer<typeof reviewPresetDtoSchema>;

const reviewDepthRequestSchema = z.object({
	preset: reviewPresetDtoSchema,
	lenses: z.array(reviewLensSchema).optional(),
	allowNitpick: z.boolean().optional(),
	maxFindings: z.int().min(1).max(30).optional(),
	effort: z.enum(["low", "high"]).nullable().optional(),
	/**
	 * A stop-threshold, not a cap (CON-015). Floored server-side, because a
	 * ceiling below one turn's cost does not prevent the run — it only makes it
	 * fail after paying.
	 */
	maxBudgetUsd: z.number().positive().nullable().optional(),
});

export const analysisRequestSchema = z.discriminatedUnion("task", [
	z.object({ task: z.literal("comprehension") }),
	z.object({
		task: z.literal("review"),
		depth: reviewDepthRequestSchema.optional(),
	}),
]);

export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;
export type ReviewDepthRequest = z.infer<typeof reviewDepthRequestSchema>;
