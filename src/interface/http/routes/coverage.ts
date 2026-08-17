import { Hono } from "hono";
import type { UpdateCoverage } from "../../../application/updateCoverage";
import { changedCoverage } from "../coverageUpdates";
import { coveragePutSchema } from "../dto/CoveragePut";
import type { CoverageSummaryDto } from "../dto/CoverageSummaryDto";
import type { SseHub } from "../events/sseHub";
import type { ReviewState } from "../reviewState";
import { validatedJson } from "../validate";

export interface CoverageRouteDeps {
	state: ReviewState;
	updateCoverage: UpdateCoverage;
	hub: SseHub;
}

/**
 * `PUT /api/coverage` — batched, idempotent, set-semantics (ARCHITECTURE §8).
 * The SSE broadcast carries only the updates that actually changed state
 * (monotonic upgrades applied, unknown hunkIds dropped), so other tabs never
 * see a downgrade or a hunk this round does not know.
 */
export function coverageRoute(deps: CoverageRouteDeps): Hono {
	const route = new Hono();

	route.put("/", async (context) => {
		const body = await validatedJson(context, coveragePutSchema);
		const review = deps.state.current();
		const { coverage, summary } = await deps.updateCoverage({
			changesetId: review.manifest.changesetId,
			files: review.files,
			coverage: review.coverage,
			updates: body.updates,
		});
		deps.state.applyCoverage(coverage);

		const applied = changedCoverage(review.coverage, coverage);
		if (applied.length > 0) {
			deps.hub.publish({ type: "coverage.updated", updates: applied, summary });
		}

		return context.json(summary satisfies CoverageSummaryDto);
	});

	return route;
}
