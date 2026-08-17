import { Hono } from "hono";
import { AnalysisError } from "../../../domain/errors/AnalysisError";
import type { UnderstandingDto } from "../dto/TopicDto";
import type { ReviewState } from "../reviewState";

export interface UnderstandingRouteDeps {
	state: ReviewState;
}

/**
 * `GET /api/understanding`: the change retold as topics, plus the orientation
 * the Overview tab renders — both from the one comprehension pass.
 *
 * 404 `not-produced` until a pass has run. "Not produced yet" is a state, not a
 * failure: the client renders the tab's invitation rather than an error, and
 * the invitation states its own cost so nothing spends on the user's behalf.
 */
export function understandingRoute(deps: UnderstandingRouteDeps): Hono {
	const route = new Hono();

	route.get("/", async (context) => {
		const analysis = await deps.state.analysis();
		if (analysis === null) {
			throw new AnalysisError(
				"not-produced",
				"This round has not been analyzed yet: run an analysis first.",
			);
		}
		const understanding: UnderstandingDto = analysis.understanding;
		return context.json(understanding);
	});

	return route;
}
