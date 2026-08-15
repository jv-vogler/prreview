import { z } from "zod";

/** Unrounded 0–100 percentages; rounding is presentation (F7). */
export const coverageSummaryDtoSchema = z.object({
	total: z.number(),
	byFile: z.record(z.string(), z.number()),
});

export type CoverageSummaryDto = z.infer<typeof coverageSummaryDtoSchema>;
