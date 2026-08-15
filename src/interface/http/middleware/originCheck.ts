import type { MiddlewareHandler } from "hono";

/** Loopback origins on any port — cross-port development, nothing remote (ARCHITECTURE §15). */
export const LOCAL_ORIGIN_PATTERN =
	/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SSE_PATH = "/api/events";

/**
 * CSRF defense for state-changing requests and the SSE stream (SEC-001):
 * `Sec-Fetch-Site: same-origin | none` is trusted outright; otherwise the
 * Origin header must match the loopback regex. A request carrying neither
 * header — a local curl — is allowed: only browsers attach these headers,
 * and only browsers can be confused into cross-origin requests.
 */
export function originCheck(): MiddlewareHandler {
	return async (context, next) => {
		const needsCheck =
			STATE_CHANGING_METHODS.has(context.req.method) ||
			context.req.path === SSE_PATH;
		if (!needsCheck) {
			return next();
		}

		const secFetchSite = context.req.header("sec-fetch-site");
		if (secFetchSite === "same-origin" || secFetchSite === "none") {
			return next();
		}

		const origin = context.req.header("origin");
		if (secFetchSite === undefined && origin === undefined) {
			return next();
		}
		if (origin !== undefined && LOCAL_ORIGIN_PATTERN.test(origin)) {
			return next();
		}

		return context.json(
			{
				reason: "forbidden-origin",
				message: "Cross-origin requests to prreview are not allowed.",
			},
			403,
		);
	};
}
