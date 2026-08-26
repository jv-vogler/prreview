import { Hono } from "hono";
import { applyFindingOps } from "../../../application/applyFindingOps";
import type { GithubService } from "../../../application/ports/GithubService";
import type { SessionStore } from "../../../application/ports/SessionStore";
import { publishReview } from "../../../application/publishReview";
import { changesetIdFor } from "../../../domain/changeset/ChangesetId";
import { EngineError } from "../../../domain/errors/EngineError";
import {
	editFindingRequestDtoSchema,
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
	githubService: GithubService | null;
}

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
		const request = await validatedJson(context, editFindingRequestDtoSchema);
		const stored = await applyFindingOps(
			{ sessionStore: deps.sessionStore },
			currentChangesetId(deps.state),
			{ kind: "edit", findingId: context.req.param("id"), body: request.body },
		);
		return context.json(toReviewPassDto(stored, deps.state.current().files));
	});

	route.delete("/comments/:id", async (context) => {
		const stored = await applyFindingOps(
			{ sessionStore: deps.sessionStore },
			currentChangesetId(deps.state),
			{ kind: "delete", findingId: context.req.param("id") },
		);
		return context.json(toReviewPassDto(stored, deps.state.current().files));
	});

	route.post("/comments/:id/restore", async (context) => {
		const stored = await applyFindingOps(
			{ sessionStore: deps.sessionStore },
			currentChangesetId(deps.state),
			{ kind: "restore", findingId: context.req.param("id") },
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
