import { Hono } from "hono";
import type { ChangesetDto } from "../dto/ChangesetDto";
import type { ReviewState } from "../reviewState";

export interface ChangesetRouteDeps {
	state: ReviewState;
}

/** `GET /api/changeset` — the resolved ref, its announcement, and files. */
export function changesetRoute(deps: ChangesetRouteDeps): Hono {
	const route = new Hono();

	route.get("/", (context) => {
		const review = deps.state.current();
		const body: ChangesetDto = {
			ref: review.ref,
			announce: review.announce,
			files: review.files,
		};
		return context.json(body);
	});

	return route;
}
