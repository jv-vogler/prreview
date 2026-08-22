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
	"crashed",
	"schema-violation",
	// the API call failed; the agent never got to answer
	"api-error",
	/** the run's own code threw — a prreview bug, not the agent's */
	"internal",
]);

export type RunFailureReasonDto = z.infer<typeof runFailureReasonDtoSchema>;

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
 * One review run. `queuedAt` is always known; `startedAt` appears once the
 * manager picked it up, which is what makes elapsed time honest for a run
 * still waiting.
 */
export const runDtoSchema = z.object({
	id: z.string(),
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
