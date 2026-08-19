import type { RunDto, RunFailureReasonDto } from "@dto/RunDto";
import type { ServerEvent } from "@dto/ServerEvent";

/** the `run.*` frames of the SSE channel (ARCHITECTURE §8) */
export type RunEvent = Extract<ServerEvent, { run: RunDto }>;

export interface RunFailure {
	runId: string;
	/** the task that failed, so "try again" retries the right pass */
	stage: string;
	reason: RunFailureReasonDto;
	message: string;
}

/**
 * What the client knows about runs: every run it has heard of, which analysis
 * run is still in flight, and why the last analysis run ended badly. Chat runs
 * live in `byId` too — one run machine serves both lanes — but they never
 * become the active analysis run, and a chat failure is reported through
 * `chat.turn.failed` rather than here.
 */
export interface RunState {
	byId: Readonly<Record<string, RunDto>>;
	activeRunId: string | null;
	lastError: RunFailure | null;
}

export const initialRunState: RunState = {
	byId: {},
	activeRunId: null,
	lastError: null,
};

const ANALYSIS_LANE = "analysis";

/**
 * The two things that can move run state: a frame off the channel, and the
 * periodic snapshot that stops a missed frame from becoming a permanent lie.
 */
export type RunAction =
	| { type: "run-event"; event: RunEvent }
	| { type: "runs-snapshot"; runs: readonly RunDto[] };

export function runStateReducer(state: RunState, action: RunAction): RunState {
	return action.type === "run-event"
		? runReducer(state, action.event)
		: reconcileRuns(state, action.runs);
}

/** frames that mean "this run is going", as opposed to a terminal verdict */
const LIVE_EVENTS = new Set<RunEvent["type"]>([
	"run.queued",
	"run.started",
	"run.progress",
]);

/**
 * Folds one `run.*` event into the run state. Pure and order-tolerant: a
 * terminal frame for a run never seen before still records it, and a frame for
 * a run other than the active one leaves `activeRunId` alone, so a chat turn
 * queued behind an analysis cannot clear the analysis tray.
 */
export function runReducer(state: RunState, event: RunEvent): RunState {
	const run = event.run;
	const byId = { ...state.byId, [run.id]: run };
	return {
		byId,
		activeRunId: nextActiveRunId(state, event),
		lastError: nextLastError(state, event),
	};
}

/**
 * Reconciles the client with what the server actually has.
 *
 * The SSE channel is the fast path, not the source of truth. A dropped
 * connection, a laptop lid, or a frame that arrived while the tab was
 * throttled all leave the client believing a finished run is still going —
 * which is exactly the "Running… forever" that makes the tool look broken when
 * the server has long since moved on. This folds a full `GET /runs` snapshot in
 * so the screen can only ever be a few seconds stale, never permanently wrong.
 */
export function reconcileRuns(
	state: RunState,
	runs: readonly RunDto[],
): RunState {
	const byId = { ...state.byId };
	for (const run of runs) {
		byId[run.id] = run;
	}

	const stillLive = runs.find(
		(run) =>
			run.lane === ANALYSIS_LANE &&
			(run.status === "queued" || run.status === "running"),
	);
	if (stillLive !== undefined) {
		return { byId, activeRunId: stillLive.id, lastError: state.lastError };
	}

	// nothing is running server-side, so nothing may claim to be running here
	const active = state.activeRunId === null ? null : byId[state.activeRunId];
	const settledUnderUs =
		active !== null &&
		active !== undefined &&
		active.status !== "queued" &&
		active.status !== "running";

	return {
		byId,
		activeRunId: settledUnderUs ? null : state.activeRunId,
		lastError:
			settledUnderUs && active.status === "failed"
				? failureOf(active)
				: state.lastError,
	};
}

function nextActiveRunId(state: RunState, event: RunEvent): string | null {
	if (event.run.lane !== ANALYSIS_LANE) {
		return state.activeRunId;
	}
	if (LIVE_EVENTS.has(event.type)) {
		return event.run.id;
	}
	return state.activeRunId === event.run.id ? null : state.activeRunId;
}

function nextLastError(state: RunState, event: RunEvent): RunFailure | null {
	if (event.run.lane !== ANALYSIS_LANE) {
		return state.lastError;
	}
	if (event.type === "run.queued" || event.type === "run.started") {
		// a fresh attempt clears the previous complaint
		return null;
	}
	if (event.type !== "run.failed") {
		return state.lastError;
	}
	return failureOf(event.run);
}

function failureOf(run: RunDto): RunFailure {
	return {
		runId: run.id,
		stage: run.stage,
		// a failed run with no error block is a server bug, not a new reason:
		// `internal` is what the copy table already answers for it
		reason: run.error?.reason ?? "internal",
		message: run.error?.message ?? "The analysis failed.",
	};
}
