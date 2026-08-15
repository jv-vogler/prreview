import { Hono } from "hono";
import { computeCoverage } from "../../../domain/coverage/computeCoverage";
import type { SessionDto } from "../dto/SessionDto";
import type { ReviewState } from "../reviewState";

/**
 * `GET /api/session` (ARCHITECTURE §8): the boot announce, toolchain, and
 * coverage summary — the same facts the CLI printed. The client never
 * re-derives any of it (REQ-008).
 */
export function sessionRoute(state: ReviewState): Hono {
	const route = new Hono();

	route.get("/", (context) => {
		const review = state.current();
		const session: SessionDto = {
			changesetId: review.manifest.changesetId,
			source: review.manifest.source,
			roundId: review.roundId,
			resumed: review.resumed,
			toolchain: review.manifest.toolchain,
			announce: review.announce,
			coverage: computeCoverage(review.files, review.coverage),
		};
		return context.json(session);
	});

	return route;
}
