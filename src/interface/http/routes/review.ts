import { Hono } from "hono";
import { applyCommentOps } from "../../../application/applyCommentOps";
import type { GithubService } from "../../../application/ports/GithubService";
import type { SessionStore } from "../../../application/ports/SessionStore";
import { publishReview } from "../../../application/publishReview";
import { changesetIdFor } from "../../../domain/changeset/ChangesetId";
import { EngineError } from "../../../domain/errors/EngineError";
import {
	editCommentRequestDtoSchema,
	reviewRunRequestDtoSchema,
	reworkRequestDtoSchema,
} from "../dto/ReviewDto";
import type { RunAcceptedDto, RunConflictDto } from "../dto/RunDto";
import type { ReviewRunner } from "../reviewRunner";
import { reviewStatusOf } from "../reviewRunner";
import type { ReviewState } from "../reviewState";
import { toReviewPassDto } from "../toReviewPassDto";
import { optionalJson, validatedJson } from "../validate";

export interface ReviewRouteDeps {
	runner: ReviewRunner;
	state: ReviewState;
	sessionStore: SessionStore;
	/** null = no GitHub backend at all (REQ-009's treatment, mirrored for publish) */
	githubService: GithubService | null;
}

/**
 * `POST /api/review` starts a run, `GET /api/review` answers the current
 * one (also the 8-second poll's fallback, TASK-037), `DELETE
 * /api/review/run` cancels it. One run at a time (TASK-033): a second
 * `POST` while one is active answers 409, never a queue.
 *
 * `PATCH`/`DELETE`/`.../restore` on one comment (TASK-046, TASK-047) all
 * answer the same way: the recomputed `ReviewPassDto`, so the client's
 * optimistic local edit reconciles against the server-authoritative
 * artifact in the same round trip rather than a second `GET`.
 * `.../rework` (TASK-048) instead starts a run, the same way `POST /` does
 * — its answer arrives through the same run status the client already
 * polls and subscribes to. `POST /publish` (TASK-050, TASK-053) answers the
 * same recomputed `ReviewPassDto` too — publishing only ever adds a
 * `published` record, it never clears the artifact.
 */
export function reviewRoute(deps: ReviewRouteDeps): Hono {
	const route = new Hono();

	route.post("/", async (context) => {
		const request = await optionalJson(context, reviewRunRequestDtoSchema);
		const result = deps.runner.start({ full: request.full === true });
		if (result.kind === "agent-missing") {
			throw new EngineError(
				"agent-missing",
				"No claude CLI was found on PATH; there is no agent to run a review with.",
			);
		}
		if (result.kind === "conflict") {
			const body: RunConflictDto = {
				reason: "run-already-running",
				message: "A review is already running.",
				existingRunId: result.existingRunId,
			};
			return context.json(body, 409);
		}
		const body: RunAcceptedDto = { runId: result.runId };
		return context.json(body, 202);
	});

	route.get("/", async (context) => {
		return context.json(await reviewStatusOf(deps.runner));
	});

	route.delete("/run", (context) => {
		const cancelled = deps.runner.cancelCurrent();
		return context.json({ cancelled }, cancelled ? 200 : 404);
	});

	route.patch("/comments/:id", async (context) => {
		const request = await validatedJson(context, editCommentRequestDtoSchema);
		const stored = await applyCommentOps(
			{ sessionStore: deps.sessionStore },
			currentChangesetId(deps.state),
			{ kind: "edit", commentId: context.req.param("id"), body: request.body },
		);
		return context.json(toReviewPassDto(stored, deps.state.current().files));
	});

	route.delete("/comments/:id", async (context) => {
		const stored = await applyCommentOps(
			{ sessionStore: deps.sessionStore },
			currentChangesetId(deps.state),
			{ kind: "delete", commentId: context.req.param("id") },
		);
		return context.json(toReviewPassDto(stored, deps.state.current().files));
	});

	route.post("/comments/:id/restore", async (context) => {
		const stored = await applyCommentOps(
			{ sessionStore: deps.sessionStore },
			currentChangesetId(deps.state),
			{ kind: "restore", commentId: context.req.param("id") },
		);
		return context.json(toReviewPassDto(stored, deps.state.current().files));
	});

	route.post("/comments/:id/rework", async (context) => {
		const request = await validatedJson(context, reworkRequestDtoSchema);
		const result = deps.runner.startRework(
			context.req.param("id"),
			request.instruction,
		);
		if (result.kind === "agent-missing") {
			throw new EngineError(
				"agent-missing",
				"No claude CLI was found on PATH; there is no agent to rework this comment with.",
			);
		}
		if (result.kind === "conflict") {
			const body: RunConflictDto = {
				reason: "run-already-running",
				message: "A review or rework is already running.",
				existingRunId: result.existingRunId,
			};
			return context.json(body, 409);
		}
		const body: RunAcceptedDto = { runId: result.runId };
		return context.json(body, 202);
	});

	route.post("/publish", async (context) => {
		const changeset = deps.state.current();
		const stored = await publishReview(
			{ githubService: deps.githubService, sessionStore: deps.sessionStore },
			currentChangesetId(deps.state),
			changeset.ref.source,
			changeset.files,
		);
		return context.json(toReviewPassDto(stored, changeset.files));
	});

	return route;
}

function currentChangesetId(state: ReviewState) {
	return changesetIdFor(state.current().ref.source);
}
