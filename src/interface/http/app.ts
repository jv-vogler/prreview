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
import { analysisRoute } from "./routes/analysis";
import { annotationsRoute } from "./routes/annotations";
import { blobRoute } from "./routes/blob";
import { changesetRoute } from "./routes/changeset";
import { chatRoute } from "./routes/chat";
import { coverageRoute } from "./routes/coverage";
import { goodbyeRoute } from "./routes/goodbye";
import { sessionRoute } from "./routes/session";
import { understandingRoute } from "./routes/understanding";
import { registerStatic } from "./static";

/** The Vite dev server's port — allowlisted only under --dev (ARCHITECTURE §15, §16). */
const VITE_DEV_PORT = 5173;

/**
 * The one place an AppError becomes an HTTP status. Reasons not listed — and
 * anything that is not an AppError — are a 500 `internal` whose stack stays in
 * the server log and never reaches the response.
 *
 * The rationale, since the mapping is not self-evident:
 * - `validation` is the client's fault; everything else here is not.
 * - the `not-found` family is 404 because the thing named does not exist:
 *   a branch, a PR, an artifact stage A never produced, a run this process
 *   has forgotten (runs are ephemeral).
 * - `locked` is 409 because another prreview holds the session — a conflict
 *   the user resolves by closing that one, not a server failure.
 * - `agent-missing` is 503: the capability is off for this whole session, and
 *   the client hides the surface anyway, so this is the defensive path.
 * - `schema-violation` is 502: prreview is a gateway to the agent here, and
 *   the agent returned something unusable.
 * - `timed-out` is 504 for the same reason, and `crashed` is a 500 because
 *   there is nothing more specific to say about a child that died.
 */
const STATUS_BY_REASON: Record<string, ContentfulStatusCode> = {
	validation: 400,
	"branch-not-found": 404,
	"pr-not-found": 404,
	"not-produced": 404,
	"run-not-found": 404,
	locked: 409,
	"gh-unauthenticated": 403,
	"agent-missing": 503,
	"schema-violation": 502,
	"timed-out": 504,
	crashed: 500,
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

	app.route(
		"/api/session",
		sessionRoute({ state: deps.state, store: deps.container.store }),
	);
	app.route("/api/goodbye", goodbyeRoute(deps.lifecycle));
	app.route(
		"/api/changeset",
		changesetRoute({
			state: deps.state,
			refreshChangeset: deps.container.refreshChangeset,
			publish: deps.container.publish,
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
	app.route(
		"/api/analysis",
		analysisRoute({
			state: deps.state,
			runAnalysis: deps.container.runAnalysis,
			runManager: deps.container.runManager,
		}),
	);
	app.route("/api/annotations", annotationsRoute({ state: deps.state }));
	app.route("/api/understanding", understandingRoute({ state: deps.state }));
	app.route(
		"/api/chat",
		chatRoute({
			state: deps.state,
			store: deps.container.store,
			chatTurn: deps.container.chatTurn,
		}),
	);
	app.get("/api/events", (context) => deps.hub.handle(context));

	if (deps.clientDir !== null) {
		registerStatic(app, deps.clientDir);
	}

	return app;
}
