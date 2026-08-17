import { Hono } from "hono";
import type { AnnotationDto } from "../dto/AnnotationDto";
import type { ReviewState } from "../reviewState";
import { toAnnotationDto } from "../toAnnotationDto";

export interface AnnotationsRouteDeps {
	state: ReviewState;
}

/**
 * `GET /api/annotations` (ARCHITECTURE §8): every annotation of the current
 * round. Read-only in M2 — an explanation is never edited, dismissed, or
 * published (F3), so `PATCH /api/annotations/:id` and the batch endpoint arrive
 * with curation in M3.
 *
 * With no agent this is an empty list rather than a 404: the viewer floor has no
 * annotations, and the client asking for them is not an error (REQ-004).
 */
export function annotationsRoute(deps: AnnotationsRouteDeps): Hono {
	const route = new Hono();

	route.get("/", async (context) => {
		const annotations = await deps.state.annotations();
		const body: AnnotationDto[] = annotations.map(toAnnotationDto);
		return context.json(body);
	});

	return route;
}
