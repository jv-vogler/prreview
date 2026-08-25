import { Hono } from "hono";
import type { ChangesetDto, ChangesetRefreshDto } from "../dto/ChangesetDto";
import type { ReviewRunner } from "../reviewRunner";
import { reviewStatusOf } from "../reviewRunner";
import type { CurrentChangeset, ReviewState } from "../reviewState";

export interface ChangesetRouteDeps {
	state: ReviewState;
	runner: ReviewRunner;
}

/**
 * `GET /api/changeset` — the resolved ref, its announcement, and files.
 * `POST /api/changeset/refresh` — the same, resolved from git again, with
 * the review status read against the snapshot that just landed.
 */
export function changesetRoute(deps: ChangesetRouteDeps): Hono {
	const route = new Hono();

	route.get("/", (context) => {
		return context.json(toChangesetDto(deps.state.current()));
	});

	route.post("/refresh", async (context) => {
		const changeset = await deps.state.refresh();
		const body: ChangesetRefreshDto = {
			changeset: toChangesetDto(changeset),
			review: await reviewStatusOf(deps.runner),
		};
		return context.json(body);
	});

	return route;
}

function toChangesetDto(changeset: CurrentChangeset): ChangesetDto {
	return {
		ref: changeset.ref,
		// the CLI's own override hint stays in the terminal: the page
		// cannot be typed into, so usage text there is noise
		announce: { resolved: changeset.announce.resolved },
		files: changeset.files,
	};
}
