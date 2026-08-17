import { Hono } from "hono";
import { intentMapFromComprehension } from "../../../application/analysis/intentMapFromComprehension";
import { AnalysisError } from "../../../domain/errors/AnalysisError";
import type { IntentMapDto } from "../dto/IntentMapDto";
import type { ReviewState } from "../reviewState";

export interface IntentMapRouteDeps {
	state: ReviewState;
}

/**
 * `GET /api/intent-map` (ARCHITECTURE §8): what this change is for, in the
 * agent's words, or 404 `not-produced` until an analysis has run. "Not produced
 * yet" is a state rather than a failure — the client renders the analysis
 * call-to-action instead of an error.
 */
export function intentMapRoute(deps: IntentMapRouteDeps): Hono {
	const route = new Hono();

	route.get("/", async (context) => {
		const analysis = await deps.state.analysis();
		if (analysis === null) {
			throw new AnalysisError(
				"not-produced",
				"This round has no intent map yet: run an analysis first.",
			);
		}
		const intentMap: IntentMapDto = intentMapFromComprehension(
			analysis.comprehension,
		);
		return context.json(intentMap);
	});

	return route;
}
