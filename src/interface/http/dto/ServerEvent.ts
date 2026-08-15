import { z } from "zod";
import { coverageUpdateDtoSchema } from "./CoveragePut";
import { coverageSummaryDtoSchema } from "./CoverageSummaryDto";

/**
 * THE single SSE channel's events (ARCHITECTURE §8), M1 subset: run.*,
 * annotation and chat events join in M2+. `coverage.updated` carries both the
 * applied updates (other tabs patch per-hunk state) and the fresh summary;
 * `changeset.drifted` deliberately carries nothing — it only raises the
 * banner, and refreshing is a user action.
 */
export const serverEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("heartbeat") }),
	z.object({
		type: z.literal("coverage.updated"),
		updates: z.array(coverageUpdateDtoSchema),
		summary: coverageSummaryDtoSchema,
	}),
	z.object({ type: z.literal("changeset.drifted") }),
]);

export type ServerEvent = z.infer<typeof serverEventSchema>;
