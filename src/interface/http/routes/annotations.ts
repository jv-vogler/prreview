import { Hono } from "hono";
import { applyAnnotationOps } from "../../../application/applyAnnotationOps";
import type { PublishEvent } from "../../../application/ports/EventPublisher";
import type { SessionStore } from "../../../application/ports/SessionStore";
import type { AnnotationDto } from "../dto/AnnotationDto";
import type { AnnotationOpsResult } from "../dto/AnnotationOpsPost";
import { annotationOpsPostSchema } from "../dto/AnnotationOpsPost";
import type { ReviewState } from "../reviewState";
import { toAnnotationDto } from "../toAnnotationDto";
import { validatedJson } from "../validate";

export interface AnnotationsRouteDeps {
	state: ReviewState;
	store: SessionStore;
	publish: PublishEvent;
}

/**
 * `GET /api/annotations` — every annotation of the current round.
 * `POST /api/annotations/ops` — the closed vocabulary of edits.
 *
 * The ops endpoint and the chat lane share **one** use-case
 * (`applyAnnotationOps`), so the six honesty gates are unskippable rather than
 * remembered. Two write paths is how one of them quietly stops checking.
 *
 * With no agent, GET is an empty list rather than a 404: the viewer floor has
 * no annotations, and the client asking for them is not an error (REQ-004).
 */
export function annotationsRoute(deps: AnnotationsRouteDeps): Hono {
	const route = new Hono();

	route.get("/", async (context) => {
		const annotations = await deps.state.annotations();
		const body: AnnotationDto[] = annotations.map(toAnnotationDto);
		return context.json(body);
	});

	route.post("/ops", async (context) => {
		const request = await validatedJson(context, annotationOpsPostSchema);
		const current = deps.state.current();
		const review = await deps.state.review();

		const outcome = await applyAnnotationOps(
			{ store: deps.store, publish: deps.publish },
			{
				changesetId: current.manifest.changesetId,
				ops: request.ops,
				/*
				 * Grounding is recomputed against what the **findings pass**
				 * actually read.
				 *
				 * It used to be handed the comprehension pass's log, which is the
				 * wrong evidence twice over: the lenses fork that session, so each
				 * child's log holds only what it opened, and a rewrite must not come
				 * back more grounded than the claim it replaced. With no review on
				 * record nothing was read, so a rewrite honestly loses its verified
				 * stamp rather than inheriting one.
				 */
				readLog: review?.readLog ?? { reads: [], searchHits: [] },
				// the stored log is already repo-relative, so there is no workspace
				// prefix left to strip. This argument used to be "" against a log of
				// absolute paths, which silently disabled the normalization and made
				// every citation compare unequal — a reword lost its stamp
				// essentially every time.
				workspaceDir: "",
				at: new Date().toISOString(),
			},
		);
		// the cached set is dropped so the next read comes from the store
		deps.state.applyAnnotations(null);

		const body: AnnotationOpsResult = {
			applied: outcome.applied,
			rejected: outcome.rejected.map((rejection) => ({
				handle: rejection.op.handle,
				reason: rejection.reason,
			})),
		};
		return context.json(body);
	});

	return route;
}
