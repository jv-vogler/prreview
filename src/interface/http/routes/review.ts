import { Hono } from "hono";
import { AnalysisError } from "../../../domain/errors/AnalysisError";
import type { ReviewSummaryDto } from "../dto/ReviewSummaryDto";
import type { ReviewState } from "../reviewState";
import { toReviewSummaryDto } from "../toReviewSummaryDto";

export interface ReviewRouteDeps {
	state: ReviewState;
}

/**
 * `GET /api/review`: what the findings pass threw away, and what it could not
 * place.
 *
 * A separate endpoint from `/api/annotations` because it answers a different
 * question. Annotations are the comments; this is the pass's own account of
 * itself, and it exists because every number in it used to be computed and then
 * dropped — which is the failure this codebase keeps repeating.
 *
 * 404 `not-produced` until a review has run, matching `/api/understanding`:
 * "not produced yet" is a state the tab renders as its invitation, not an error.
 */
export function reviewRoute(deps: ReviewRouteDeps): Hono {
	const route = new Hono();

	route.get("/", async (context) => {
		const review = await deps.state.review();
		if (review === null) {
			throw new AnalysisError(
				"not-produced",
				"This round has not been reviewed yet: run a review first.",
			);
		}
		const body: ReviewSummaryDto = toReviewSummaryDto(review);
		return context.json(body);
	});

	return route;
}
