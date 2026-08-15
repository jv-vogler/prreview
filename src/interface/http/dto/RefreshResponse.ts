import { z } from "zod";
import { changesetDtoSchema } from "./ChangesetDto";
import { coverageSummaryDtoSchema } from "./CoverageSummaryDto";

/**
 * `POST /api/changeset/refresh` (ARCHITECTURE §8): the new round's changeset
 * plus the coverage summary after carry-over, so the client patches both
 * caches from one response.
 */
export const refreshResponseSchema = z.object({
	changeset: changesetDtoSchema,
	coverage: coverageSummaryDtoSchema,
});

export type RefreshResponse = z.infer<typeof refreshResponseSchema>;
