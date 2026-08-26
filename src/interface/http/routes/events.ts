import { Hono } from "hono";
import type { SseHub } from "../events/sseHub";

export interface EventsRouteDeps {
	hub: SseHub;
}

export function eventsRoute(deps: EventsRouteDeps): Hono {
	const route = new Hono();
	route.get("/", (context) => deps.hub.handle(context));
	return route;
}
