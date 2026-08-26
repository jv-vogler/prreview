import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Container } from "../../container";
import { AppError } from "../../domain/errors/AppError";
import type { ChangesetErrorReason } from "../../domain/errors/ChangesetError";
import type { EngineErrorReason } from "../../domain/errors/EngineError";
import type { FindingErrorReason } from "../../domain/errors/FindingError";
import type { GithubErrorReason } from "../../domain/errors/GithubError";
import type { PublishErrorReason } from "../../domain/errors/PublishError";
import type { StoreErrorReason } from "../../domain/errors/StoreError";
import type { ValidationErrorReason } from "../../domain/errors/ValidationError";
import { deriveFeatureFlags } from "../../domain/session/deriveFeatureFlags";
import type { ErrorDto } from "./dto/ErrorDto";
import type { SessionDto } from "./dto/SessionDto";
import type { SseHub } from "./events/sseHub";
import type { ReviewRunner } from "./reviewRunner";
import type { ReviewState } from "./reviewState";
import { blobRoute } from "./routes/blob";
import { changesetRoute } from "./routes/changeset";
import { eventsRoute } from "./routes/events";
import { reviewRoute } from "./routes/review";
import { registerStatic } from "./static";

type AppErrorReason =
	| ChangesetErrorReason
	| EngineErrorReason
	| FindingErrorReason
	| GithubErrorReason
	| PublishErrorReason
	| StoreErrorReason
	| ValidationErrorReason;

const STATUS_BY_REASON: Record<string, ContentfulStatusCode | undefined> = {
	validation: 400,
	"branch-not-found": 404,
	"pr-not-found": 404,
	"gh-unauthenticated": 403,
	"unsupported-backend": 503,
	"agent-missing": 503,
	"no-review": 404,
	"comment-not-found": 404,
	"not-a-pull-request": 400,
	"no-github": 503,
	"nothing-publishable": 400,
} satisfies Partial<Record<AppErrorReason, ContentfulStatusCode>>;

export interface AppDeps {
	container: Container;
	state: ReviewState;
	runner: ReviewRunner;
	hub: SseHub;
	repoRoot: string;
	clientDir: string | null;

	logError?: (error: unknown) => void;
}

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

	app.get("/api/session", (context) => {
		const body: SessionDto = {
			status: "ok",
			serverTime: deps.container.clock.now().toISOString(),
			featureFlags: deriveFeatureFlags(deps.container.toolchain),
		};
		return context.json(body);
	});
	app.route(
		"/api/changeset",
		changesetRoute({ state: deps.state, runner: deps.runner }),
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
		"/api/review",
		reviewRoute({
			runner: deps.runner,
			state: deps.state,
			sessionStore: deps.container.sessionStore,
			githubService: deps.container.githubService,
		}),
	);
	app.route("/api/events", eventsRoute({ hub: deps.hub }));

	if (deps.clientDir !== null) {
		registerStatic(app, deps.clientDir);
	}

	return app;
}
