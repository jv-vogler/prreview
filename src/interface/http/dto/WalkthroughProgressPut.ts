import { z } from "zod";
import { coverageSummaryDtoSchema } from "./CoverageSummaryDto";
import { walkthroughProgressDtoSchema } from "./WalkthroughDto";

/**
 * `PUT /api/walkthrough/progress` (ARCHITECTURE §8): the step being entered.
 * Idempotent and monotonic — replaying a step never downgrades coverage.
 */
export const walkthroughProgressPutSchema = z.object({
	position: z.int().min(0),
	completed: z.boolean(),
});

export type WalkthroughProgressPut = z.infer<
	typeof walkthroughProgressPutSchema
>;

/**
 * One response carries both halves of what entering a step changed: where the
 * reader is, and the fresh coverage summary the step's hunks moved — so the
 * ring is never computed in the browser (REQ-008).
 */
export const walkthroughProgressResponseSchema = z.object({
	progress: walkthroughProgressDtoSchema,
	coverage: coverageSummaryDtoSchema,
});

export type WalkthroughProgressResponse = z.infer<
	typeof walkthroughProgressResponseSchema
>;
