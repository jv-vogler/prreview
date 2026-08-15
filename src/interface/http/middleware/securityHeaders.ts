import type { MiddlewareHandler } from "hono";

/**
 * The SPA's CSP (ARCHITECTURE §15): 'unsafe-inline' styles for Shiki,
 * `worker-src 'self' blob:` for Pierre's worker pool, everything else self.
 */
const CONTENT_SECURITY_POLICY = [
	"default-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"worker-src 'self' blob:",
	"frame-ancestors 'none'",
].join("; ");

const API_PATH_PREFIX = "/api";

/** Second in the SEC-001 stack: hardening headers on every response. */
export function securityHeaders(): MiddlewareHandler {
	return async (context, next) => {
		await next();
		context.header("X-Content-Type-Options", "nosniff");
		context.header("X-Frame-Options", "DENY");
		context.header("Referrer-Policy", "no-referrer");
		context.header("Cross-Origin-Opener-Policy", "same-origin");
		context.header("Cross-Origin-Resource-Policy", "same-origin");
		context.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
		if (context.req.path.startsWith(API_PATH_PREFIX)) {
			context.header("Cache-Control", "no-store");
		}
	};
}
