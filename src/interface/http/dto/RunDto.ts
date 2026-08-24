import { z } from "zod";
import { reviewPassDtoSchema } from "./ReviewDto";

/**
 * Why a run ended badly. Spelled out rather than left a free string so the
 * client can hold one exhaustive copy table and a new reason cannot ship
 * without user-facing text.
 */
export const runFailureReasonDtoSchema = z.enum([
	"agent-missing",
	"timed-out",
	/** the run spent its turn budget before it finished */
	"out-of-turns",
	"crashed",
	"schema-violation",
	// the API call failed; the agent never got to answer
	"api-error",
	/** the run's own code threw — a prreview bug, not the agent's */
	"internal",
]);

export type RunFailureReasonDto = z.infer<typeof runFailureReasonDtoSchema>;

export const itineraryStepDtoSchema = z.object({
	/** the agent's own wording for this step */
	label: z.string(),
	state: z.enum(["pending", "active", "done"]),
});

export type ItineraryStepDto = z.infer<typeof itineraryStepDtoSchema>;

/**
 * What the run is doing, so the UI never has to show a bare spinner.
 *
 * `lastActivityAt` is the load-bearing field: elapsed time alone cannot tell
 * a slow run from a hung one, and the difference is the whole reason a
 * reader would reach for a terminal to check on their own tool.
 */
export const runProgressDtoSchema = z.object({
	/** the current move in plain words; null before the agent's first */
	activity: z.string().nullable(),
	toolCalls: z.int().min(0),
	/** the agent's own plan, echoed back; null until it writes one */
	itinerary: z.array(itineraryStepDtoSchema).nullable(),
	lastActivityAt: z.string(),
});

export type RunProgressDto = z.infer<typeof runProgressDtoSchema>;

export const runStatusDtoSchema = z.enum([
	"queued",
	"running",
	"succeeded",
	"failed",
	"cancelled",
	"timed-out",
]);

/**
 * `review` is a full pass; `rework` (TASK-048/049) is a single-comment call
 * sharing the same run slot. `RunStatusBar` shows only `review` runs — a
 * rework's status renders next to the comment it targets instead.
 */
export const runKindDtoSchema = z.enum(["review", "rework"]);

export type RunKindDto = z.infer<typeof runKindDtoSchema>;

/**
 * One review run. `queuedAt` is always known; `startedAt` appears once the
 * manager picked it up, which is what makes elapsed time honest for a run
 * still waiting. `commentId`/`result` only appear on a `kind: "rework"` run
 * — `result` is the proposed body once it has succeeded, never persisted on
 * its own (TASK-046 owns the only write path).
 */
export const runDtoSchema = z.object({
	id: z.string(),
	kind: runKindDtoSchema,
	status: runStatusDtoSchema,
	queuedAt: z.string(),
	startedAt: z.string().optional(),
	endedAt: z.string().optional(),
	error: z
		.object({ reason: runFailureReasonDtoSchema, message: z.string() })
		.optional(),
	progress: runProgressDtoSchema.optional(),
	/** how long this run may go silent before it is stopped; not a wall clock */
	idleTimeoutMs: z.int().min(0),
	commentId: z.string().optional(),
	result: z.string().optional(),
});

export type RunDto = z.infer<typeof runDtoSchema>;

/** 202 from `POST /api/review`: the answer arrives over SSE and the poll, not here */
export const runAcceptedDtoSchema = z.object({ runId: z.string() });

export type RunAcceptedDto = z.infer<typeof runAcceptedDtoSchema>;

/**
 * 409 from `POST /api/review` when a review is already running (TASK-033:
 * one lane, one run at a time).
 */
export const runConflictDtoSchema = z.object({
	reason: z.literal("run-already-running"),
	message: z.string(),
	existingRunId: z.string(),
});

export type RunConflictDto = z.infer<typeof runConflictDtoSchema>;

/**
 * `GET /api/review`'s answer: the current run (if any this process has
 * seen), and the last completed pass (if any is on disk) — decoupled from
 * each other, so a persisted pass from before a server restart still shows
 * even though `run` is null.
 */
export const reviewStatusDtoSchema = z.object({
	run: runDtoSchema.nullable(),
	pass: reviewPassDtoSchema.nullable(),
});

export type ReviewStatusDto = z.infer<typeof reviewStatusDtoSchema>;
