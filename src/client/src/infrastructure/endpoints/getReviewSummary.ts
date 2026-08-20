import type { ReviewSummaryDto } from "@dto/ReviewSummaryDto";
import { reviewSummaryDtoSchema } from "@dto/ReviewSummaryDto";
import { nullWhenNotProduced } from "../endpoints-helpers/nullWhenNotProduced";
import { parseLogged } from "../endpoints-helpers/parseLogged";
import type { ApiClient } from "../httpClients/apiClient";

/**
 * `GET /api/review` — what the findings pass threw away, and what it could not
 * place.
 *
 * A 404 with reason `not-produced` is a state, not a failure: no review has run
 * against this round, so `null` is a legitimate answer and the tab shows its
 * invitation.
 */
export async function getReviewSummary(
	api: ApiClient,
): Promise<ReviewSummaryDto | null> {
	return nullWhenNotProduced(async () =>
		parseLogged(
			reviewSummaryDtoSchema,
			await api.get("/api/review"),
			"review summary",
		),
	);
}
