import { Hono } from "hono";
import { EngineError } from "../../../domain/errors/EngineError";
import type {
	ReviewStatusDto,
	RunAcceptedDto,
	RunConflictDto,
} from "../dto/RunDto";
import type { ReviewRunner } from "../reviewRunner";

export interface ReviewRouteDeps {
	runner: ReviewRunner;
}

/**
 * `POST /api/review` starts a run, `GET /api/review` answers the current
 * one (also the 8-second poll's fallback, TASK-037), `DELETE
 * /api/review/run` cancels it. One run at a time (TASK-033): a second
 * `POST` while one is active answers 409, never a queue.
 */
export function reviewRoute(deps: ReviewRouteDeps): Hono {
	const route = new Hono();

	route.post("/", (context) => {
		const result = deps.runner.start();
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
		const pass = await deps.runner.currentPass();
		const body: ReviewStatusDto = { run: deps.runner.current(), pass };
		return context.json(body);
	});

	route.delete("/run", (context) => {
		const cancelled = deps.runner.cancelCurrent();
		return context.json({ cancelled }, cancelled ? 200 : 404);
	});

	return route;
}
