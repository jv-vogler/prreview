import { Hono } from "hono";
import type { ChangesetDto, ChangesetRefreshDto } from "../dto/ChangesetDto";
import type { ReviewRunner } from "../reviewRunner";
import { reviewStatusOf } from "../reviewRunner";
import type { CurrentChangeset, ReviewState } from "../reviewState";

export interface ChangesetRouteDeps {
	state: ReviewState;
	runner: ReviewRunner;
}

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

		announce: { resolved: changeset.announce.resolved },
		files: changeset.files,
	};
}
