import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Container } from "../../container";
import { AppError } from "../../domain/errors/AppError";
import type { ErrorDto } from "./dto/ErrorDto";
import type { SseHub } from "./events/sseHub";
import type { Lifecycle } from "./lifecycle";
import { requestBodyLimit } from "./middleware/bodyLimit";
import { localhostCors } from "./middleware/cors";
import { hostAllowlist } from "./middleware/hostAllowlist";
import { originCheck } from "./middleware/originCheck";
import { securityHeaders } from "./middleware/securityHeaders";
import type { ReviewState } from "./reviewState";
import { blobRoute } from "./routes/blob";
import { changesetRoute } from "./routes/changeset";
import { coverageRoute } from "./routes/coverage";
import { goodbyeRoute } from "./routes/goodbye";
import { sessionRoute } from "./routes/session";
import { registerStatic } from "./static";

/** The Vite dev server's port — allowlisted only under --dev (ARCHITECTURE §15, §16). */
const VITE_DEV_PORT = 5173;

/**
 * The one place an AppError becomes an HTTP status (TASK-038). Reasons not
 * listed — and anything that is not an AppError — are a 500 `internal` whose
 * stack stays in the server log and never reaches the response.
 */
const STATUS_BY_REASON: Record<string, ContentfulStatusCode> = {
	validation: 400,
	"branch-not-found": 404,
	"pr-not-found": 404,
	locked: 409,
	"gh-unauthenticated": 403,
};

export interface AppDeps {
	container: Container;
	state: ReviewState;
	hub: SseHub;
	lifecycle: Lifecycle;
	/** absolute repo toplevel — the WORKING blob containment root (SEC-002) */
	repoRoot: string;
	/** the port the server actually bound — part of the Host allowlist */
	boundPort: number;
	dev: boolean;
	/** built client directory; null skips static serving (--dev, tests) */
	clientDir: string | null;
	/** test seam; defaults to console.error */
	logError?: (error: unknown) => void;
}

/** The Hono app: SEC-001 middleware order, routes, one onError — nothing else catches. */
export function createApp(deps: AppDeps): Hono {
	const logError = deps.logError ?? ((error: unknown) => console.error(error));
	const app = new Hono();

	app.onError((error, context) => {
		if (error instanceof AppError) {
			const status = STATUS_BY_REASON[error.reason];
			if (status !== undefined) {
				const body: ErrorDto = { reason: error.reason, message: error.message };
				return context.json(body, status);
			}
		}
		logError(error);
		const body: ErrorDto = {
			reason: "internal",
			message:
				"Something went wrong inside prreview; the server log has details.",
		};
		return context.json(body, 500);
	});

	// SEC-001: hostAllowlist → securityHeaders → cors (dev-only) → originCheck
	// → bodyLimit → routes, exactly in this order
	const allowedPorts = deps.dev
		? [deps.boundPort, VITE_DEV_PORT]
		: [deps.boundPort];
	app.use(hostAllowlist({ allowedPorts }));
	app.use(securityHeaders());
	if (deps.dev) {
		app.use(localhostCors());
	}
	app.use(originCheck());
	app.use(requestBodyLimit());

	app.route("/api/session", sessionRoute(deps.state));
	app.route("/api/goodbye", goodbyeRoute(deps.lifecycle));
	app.route(
		"/api/changeset",
		changesetRoute({
			state: deps.state,
			refreshChangeset: deps.container.refreshChangeset,
		}),
	);
	app.route(
		"/api/blob",
		blobRoute({
			state: deps.state,
			git: deps.container.git,
			repoRoot: deps.repoRoot,
		}),
	);
	app.route(
		"/api/coverage",
		coverageRoute({
			state: deps.state,
			updateCoverage: deps.container.updateCoverage,
			hub: deps.hub,
		}),
	);
	app.get("/api/events", (context) => deps.hub.handle(context));

	if (deps.clientDir !== null) {
		registerStatic(app, deps.clientDir);
	}

	return app;
}
