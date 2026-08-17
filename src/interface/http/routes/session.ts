import { Hono } from "hono";
import type { SessionStore } from "../../../application/ports/SessionStore";
import { computeCoverage } from "../../../domain/coverage/computeCoverage";
import type { SessionAnalysisDto, SessionDto } from "../dto/SessionDto";
import type { ReviewState } from "../reviewState";

export interface SessionRouteDeps {
	state: ReviewState;
	store: SessionStore;
}

/**
 * `GET /api/session` (ARCHITECTURE §8): the boot announce, toolchain, coverage
 * summary, and what analysis has already produced — the client never re-derives
 * any of it (REQ-008). The analysis block is counts and flags rather than the
 * artifacts themselves, because its job is to let the first render decide where
 * to send the reader without waiting on a second request (§9).
 */
export function sessionRoute(deps: SessionRouteDeps): Hono {
	const route = new Hono();

	route.get("/", async (context) => {
		const review = deps.state.current();
		const session: SessionDto = {
			changesetId: review.manifest.changesetId,
			source: review.manifest.source,
			roundId: review.roundId,
			resumed: review.resumed,
			toolchain: review.manifest.toolchain,
			announce: review.announce,
			coverage: computeCoverage(review.files, review.coverage),
			analysis: await analysisSummary(deps),
		};
		return context.json(session);
	});

	return route;
}

async function analysisSummary(
	deps: SessionRouteDeps,
): Promise<SessionAnalysisDto> {
	const review = deps.state.current();
	const [analysis, annotations, progress] = await Promise.all([
		deps.state.analysis(),
		deps.state.annotations(),
		deps.store.loadWalkthroughProgress(review.manifest.changesetId),
	]);
	return {
		intentMapAvailable: analysis !== null,
		walkthroughAvailable:
			analysis !== null && analysis.comprehension.walkthrough.steps.length > 0,
		annotationCount: annotations.length,
		...(progress === null ? {} : { walkthroughProgress: progress }),
	};
}
