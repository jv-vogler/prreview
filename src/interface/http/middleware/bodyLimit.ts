import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

/** Nothing a review client sends is anywhere near this (SEC-001: 1MB). */
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

/** Last middleware before the routes: oversized request bodies get 413. */
export function requestBodyLimit(): MiddlewareHandler {
	return bodyLimit({
		maxSize: MAX_REQUEST_BODY_BYTES,
		onError: (context) =>
			context.json(
				{
					reason: "payload-too-large",
					message: "Request bodies are limited to 1MB.",
				},
				413,
			),
	});
}
