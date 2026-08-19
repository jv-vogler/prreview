import { z } from "zod";

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
	/** the lane's own work threw — a prreview bug, not the agent's */
	"internal",
]);

export type RunFailureReasonDto = z.infer<typeof runFailureReasonDtoSchema>;

/**
 * What a run is doing, so the UI never has to show a bare spinner.
 *
 * `lastActivityAt` is the load-bearing field: elapsed time alone cannot tell a
 * slow run from a hung one, and the difference is the whole reason a reader
 * would reach for a terminal to check on their own tool.
 */
export const runProgressDtoSchema = z.object({
	/** the current move in plain words; null before the agent's first */
	activity: z.string().nullable(),
	toolCalls: z.int().min(0),
	lastActivityAt: z.string(),
	/** a fan-out's finished children, when this run has children */
	partsDone: z.int().min(0).optional(),
	partsTotal: z.int().min(0).optional(),
});

export type RunProgressDto = z.infer<typeof runProgressDtoSchema>;

/**
 * One run of the two-lane manager (ARCHITECTURE §7, §8), carried by every
 * `run.*` event and served by `GET /api/analysis/runs`. `queuedAt` is always
 * known; `startedAt` appears when the lane picked the run up, which is what
 * makes elapsed time honest for a run still waiting behind another.
 */
export const runDtoSchema = z.object({
	id: z.string(),
	/** the task type: `comprehension` on the analysis lane, `chat` on the chat lane */
	stage: z.string(),
	lane: z.enum(["analysis", "chat"]),
	status: z.enum([
		"queued",
		"running",
		"succeeded",
		"failed",
		"cancelled",
		"timed-out",
	]),
	queuedAt: z.string(),
	startedAt: z.string().optional(),
	endedAt: z.string().optional(),
	error: z
		.object({ reason: runFailureReasonDtoSchema, message: z.string() })
		.optional(),
	/** anchors the agent named that could not be placed and were dropped */
	skippedAnchors: z.int().min(0).optional(),
	progress: runProgressDtoSchema.optional(),
	/** how long this run may go silent before it is stopped; not a wall clock */
	idleTimeoutMs: z.int().min(0),
});

export type RunDto = z.infer<typeof runDtoSchema>;

/** 202 from `POST /api/analysis`: the answer arrives over SSE, not here */
export const runAcceptedDtoSchema = z.object({ runId: z.string() });

export type RunAcceptedDto = z.infer<typeof runAcceptedDtoSchema>;

/**
 * 409 from `POST /api/analysis` when the same task is already running. An
 * ordinary negative outcome, returned rather than thrown (M1's precedent), and
 * it names the run so the UI can offer "cancel and re-run".
 */
export const runConflictDtoSchema = z.object({
	reason: z.literal("run-already-running"),
	message: z.string(),
	existingRunId: z.string(),
});

export type RunConflictDto = z.infer<typeof runConflictDtoSchema>;
