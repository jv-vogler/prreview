import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { LOCAL_ORIGIN_PATTERN } from "./originCheck";

/**
 * Dev-only CORS (SEC-001): lets the Vite tab on :5173 talk to the API across
 * ports. Only mounted under `--dev`; production is single-origin and never
 * needs it (ARCHITECTURE §15 "inert in production").
 */
export function localhostCors(): MiddlewareHandler {
	return cors({
		origin: (origin) => (LOCAL_ORIGIN_PATTERN.test(origin) ? origin : ""),
	});
}
