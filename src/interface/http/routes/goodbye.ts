import { Hono } from "hono";
import type { Lifecycle } from "../lifecycle";

/**
 * `POST /api/goodbye` (ARCHITECTURE §3): the pagehide sendBeacon. Counts the
 * tab as gone ahead of its EventSource teardown so shutdown starts promptly.
 */
export function goodbyeRoute(lifecycle: Lifecycle): Hono {
	const route = new Hono();

	route.post("/", (context) => {
		lifecycle.goodbyeReceived();
		return context.body(null, 204);
	});

	return route;
}
