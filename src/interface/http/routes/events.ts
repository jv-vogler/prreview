import { Hono } from "hono";
import type { SseHub } from "../events/sseHub";

export interface EventsRouteDeps {
	hub: SseHub;
}

/** `GET /api/events`: the one SSE channel (TASK-035). */
export function eventsRoute(deps: EventsRouteDeps): Hono {
	const route = new Hono();
	route.get("/", (context) => deps.hub.handle(context));
	return route;
}
