import { Hono } from "hono";
import { walkthroughFromComprehension } from "../../../application/analysis/walkthroughFromComprehension";
import type { UpdateWalkthroughProgress } from "../../../application/updateWalkthroughProgress";
import { AnalysisError } from "../../../domain/errors/AnalysisError";
import { changedCoverage } from "../coverageUpdates";
import type { WalkthroughDto } from "../dto/WalkthroughDto";
import type { WalkthroughProgressResponse } from "../dto/WalkthroughProgressPut";
import { walkthroughProgressPutSchema } from "../dto/WalkthroughProgressPut";
import type { SseHub } from "../events/sseHub";
import type { ReviewState } from "../reviewState";
import { validatedJson } from "../validate";

export interface WalkthroughRouteDeps {
	state: ReviewState;
	updateWalkthroughProgress: UpdateWalkthroughProgress;
	hub: SseHub;
}

/**
 * The guided reading order (ARCHITECTURE §8, F5). `GET /api/walkthrough` serves
 * the steps or 404s with `not-produced` until stage A has run.
 * `PUT /api/walkthrough/progress` records the step being entered and marks its
 * hunks viewed in the same call — reading a step IS reviewing it (§7) — and
 * answers with both halves so the coverage ring is never computed in the
 * browser (REQ-008).
 */
export function walkthroughRoute(deps: WalkthroughRouteDeps): Hono {
	const route = new Hono();

	route.get("/", async (context) => {
		const analysis = await deps.state.analysis();
		if (analysis === null) {
			throw new AnalysisError(
				"not-produced",
				"This round has no walkthrough yet: run an analysis first.",
			);
		}
		const walkthrough: WalkthroughDto = walkthroughFromComprehension(
			analysis.comprehension,
		);
		return context.json(walkthrough);
	});

	route.put("/progress", async (context) => {
		const body = await validatedJson(context, walkthroughProgressPutSchema);
		const review = deps.state.current();
		const updated = await deps.updateWalkthroughProgress({
			changesetId: review.manifest.changesetId,
			roundId: review.roundId,
			files: review.files,
			coverage: review.coverage,
			position: body.position,
			completed: body.completed,
		});
		deps.state.applyCoverage(updated.coverage);

		const applied = changedCoverage(review.coverage, updated.coverage);
		if (applied.length > 0) {
			deps.hub.publish({
				type: "coverage.updated",
				updates: applied,
				summary: updated.summary,
			});
		}

		const response: WalkthroughProgressResponse = {
			progress: updated.progress,
			coverage: updated.summary,
		};
		return context.json(response);
	});

	return route;
}
