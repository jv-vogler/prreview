import { Hono } from "hono";
import type { RefreshChangeset } from "../../../application/refreshChangeset";
import { computeCoverage } from "../../../domain/coverage/computeCoverage";
import type { ChangesetDto } from "../dto/ChangesetDto";
import type { RefreshResponse } from "../dto/RefreshResponse";
import type { ReviewState } from "../reviewState";

export interface ChangesetRouteDeps {
	state: ReviewState;
	refreshChangeset: RefreshChangeset;
}

/**
 * `GET /api/changeset` — the current round's files, hunks, and ref.
 * `POST /api/changeset/refresh` — the user's answer to the drift banner
 * (ARCHITECTURE §12): re-resolve, open round r(N+1), carry coverage, and
 * return both so the client patches its caches from one response.
 */
export function changesetRoute(deps: ChangesetRouteDeps): Hono {
	const route = new Hono();

	route.get("/", (context) => {
		return context.json(changesetDtoFor(deps.state));
	});

	route.post("/refresh", async (context) => {
		const review = deps.state.current();
		const refreshed = await deps.refreshChangeset({
			manifest: review.manifest,
			coverage: review.coverage,
		});
		deps.state.applyRefresh(refreshed);

		const response: RefreshResponse = {
			changeset: changesetDtoFor(deps.state),
			coverage: computeCoverage(refreshed.files, refreshed.coverage),
		};
		return context.json(response);
	});

	return route;
}

function changesetDtoFor(state: ReviewState): ChangesetDto {
	const review = state.current();
	return {
		changesetId: review.manifest.changesetId,
		roundId: review.roundId,
		ref: review.ref,
		files: review.files,
	};
}
