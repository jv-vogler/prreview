import { z } from "zod";

const walkthroughStepFocusDtoSchema = z.object({
	path: z.string(),
	hunkIds: z.array(z.string()),
});

const walkthroughStepDtoSchema = z.object({
	/** 0-based reading order; the UI shows it as "step 3 of 9" */
	index: z.int().min(0),
	title: z.string(),
	narration: z.string(),
	focus: z.array(walkthroughStepFocusDtoSchema),
});

/**
 * `GET /api/walkthrough` (ARCHITECTURE §8): the guided reading order derived
 * from stage A. 404 with reason `not-produced` until stage A has run.
 */
export const walkthroughDtoSchema = z.object({
	steps: z.array(walkthroughStepDtoSchema),
});

export type WalkthroughDto = z.infer<typeof walkthroughDtoSchema>;

/** where the reader is, persisted so F13 can resume it (§8) */
export const walkthroughProgressDtoSchema = z.object({
	position: z.int().min(0),
	completed: z.boolean(),
});

export type WalkthroughProgressDto = z.infer<
	typeof walkthroughProgressDtoSchema
>;
