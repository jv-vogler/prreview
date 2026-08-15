import { z } from "zod";

/**
 * Only upgrades travel: `unseen` is the absence of a record, never a state a
 * client can put back (coverage is monotonic, ARCHITECTURE §8).
 */
export const coverageUpdateDtoSchema = z.object({
	hunkId: z.string().min(1),
	state: z.enum(["viewed", "reviewed"]),
});

export type CoverageUpdateDto = z.infer<typeof coverageUpdateDtoSchema>;

/** `PUT /api/coverage`: batched, idempotent, set-semantics (ARCHITECTURE §8). */
export const coveragePutSchema = z.object({
	updates: z.array(coverageUpdateDtoSchema),
});

export type CoveragePut = z.infer<typeof coveragePutSchema>;
