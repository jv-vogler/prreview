import { Hono } from "hono";
import type { RunManager } from "../../../application/ports/RunManager";
import type { RunAnalysis } from "../../../application/runAnalysis";
import type { RunReview } from "../../../application/runReview";
import { AnalysisError } from "../../../domain/errors/AnalysisError";
import type { ReviewDepth } from "../../../domain/review/ReviewDepth";
import {
	customDepth,
	depthForPreset,
} from "../../../domain/review/ReviewDepth";
import type { ReviewDepthRequest } from "../dto/AnalysisRequest";
import { analysisRequestSchema } from "../dto/AnalysisRequest";
import type { RunAcceptedDto, RunConflictDto, RunDto } from "../dto/RunDto";
import type { ReviewState } from "../reviewState";
import { toRunDto } from "../toRunDto";
import { validatedJson } from "../validate";

const HTTP_ACCEPTED = 202;
const HTTP_CONFLICT = 409;
const HTTP_NO_CONTENT = 204;

export interface AnalysisRouteDeps {
	state: ReviewState;
	runAnalysis: RunAnalysis;
	runReview: RunReview;
	runManager: RunManager;
}

/**
 * The run machine on the wire (ARCHITECTURE §8): one endpoint triggers every
 * task type, and the answer never comes back through it. `POST /api/analysis`
 * returns 202 the moment the run is queued — a comprehension pass takes minutes
 * — and the result arrives as `run.*` and `annotation.upserted` events on the
 * SSE channel.
 *
 * Asking twice is not an error: a second request while the first is still queued
 * collapses onto the same run, and one already running answers 409 naming it, so
 * the UI can offer "cancel and re-run" instead of quietly starting a second
 * pass on the user's own budget.
 */
/**
 * Turns a request's depth preference into a real depth.
 *
 * The lens locks live in `customDepth`, not here and not in the dialog: a
 * checkbox the UI disables is still one line of curl away, and "review this but
 * skip the security lens" must not be reachable from the wire.
 */
function resolveDepth(request: ReviewDepthRequest | undefined): ReviewDepth {
	if (request === undefined) {
		return depthForPreset("standard");
	}
	if (request.preset !== "custom") {
		return depthForPreset(request.preset);
	}
	return customDepth({
		lenses: request.lenses ?? [],
		...(request.allowNitpick === undefined
			? {}
			: { allowNitpick: request.allowNitpick }),
		...(request.maxFindings === undefined
			? {}
			: { maxFindings: request.maxFindings }),
		effort: request.effort ?? null,
		maxBudgetUsd: request.maxBudgetUsd ?? null,
	});
}

export function analysisRoute(deps: AnalysisRouteDeps): Hono {
	const route = new Hono();

	route.post("/", async (context) => {
		const request = await validatedJson(context, analysisRequestSchema);
		const review = deps.state.current();
		const enqueued =
			request.task === "review"
				? await deps.runReview({
						manifest: review.manifest,
						roundId: review.roundId,
						ref: review.ref,
						files: review.files,
						// depth is resolved here, where the locks are applied: the
						// request is a preference, not an instruction
						depth: resolveDepth(request.depth),
					})
				: await deps.runAnalysis({
						manifest: review.manifest,
						roundId: review.roundId,
						ref: review.ref,
						files: review.files,
						ticket: review.manifest.ticket ?? null,
					});

		if (enqueued.kind === "conflict") {
			const conflict: RunConflictDto = {
				reason: "run-already-running",
				message:
					"An analysis of this change is already running. Cancel it before starting another.",
				existingRunId: enqueued.existingRunId,
			};
			return context.json(conflict, HTTP_CONFLICT);
		}
		const accepted: RunAcceptedDto = { runId: enqueued.runId };
		return context.json(accepted, HTTP_ACCEPTED);
	});

	route.get("/runs", (context) => {
		const runs: RunDto[] = deps.runManager.list().map(toRunDto);
		return context.json(runs);
	});

	route.get("/runs/:id", (context) => {
		return context.json(toRunDto(requireRun(deps, context.req.param("id"))));
	});

	route.post("/runs/:id/cancel", (context) => {
		// cancelling a run that already settled is not a failure — the caller
		// wanted it stopped, and it is stopped
		requireRun(deps, context.req.param("id"));
		deps.runManager.cancel(context.req.param("id"));
		return context.body(null, HTTP_NO_CONTENT);
	});

	return route;
}

/** Runs are ephemeral (§7): a restart forgets them, and so does a bad id. */
function requireRun(deps: AnalysisRouteDeps, runId: string) {
	const run = deps.runManager.get(runId);
	if (run === undefined) {
		throw new AnalysisError(
			"run-not-found",
			`No run ${runId} exists in this session.`,
		);
	}
	return run;
}
