import { z } from "zod";

/**
 * A hunk's reading state, as the reader set it.
 *
 * `unseen` is on the wire because unticking "Viewed" has to mean something.
 * It did not used to be: coverage was fed by a scroll observer, and letting a
 * client put a hunk back would have made an out-of-order event able to erase
 * deliberate work. Nothing infers coverage now — a person ticks a box — so a
 * request to clear one is a request, not a race.
 */
export const coverageUpdateDtoSchema = z.object({
	hunkId: z.string().min(1),
	state: z.enum(["unseen", "viewed", "reviewed"]),
});

export type CoverageUpdateDto = z.infer<typeof coverageUpdateDtoSchema>;

/** `PUT /api/coverage`: batched, idempotent, set-semantics (ARCHITECTURE §8). */
export const coveragePutSchema = z.object({
	updates: z.array(coverageUpdateDtoSchema),
});

export type CoveragePut = z.infer<typeof coveragePutSchema>;
