import { z } from "zod";

/**
 * `POST /api/analysis` (ARCHITECTURE §8): one endpoint for every task type, so
 * queueing, cancelling, and status semantics exist once. The enum has a single
 * member on purpose — M2 ships stage A only, and M3/M4 add members here rather
 * than new endpoints.
 */
export const analysisRequestSchema = z.object({
	task: z.enum(["comprehension"]),
});

export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;
