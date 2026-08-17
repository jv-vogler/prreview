import type { RunDto, RunFailureReasonDto } from "@dto/RunDto";
import type { ServerEvent } from "@dto/ServerEvent";

/** the five `run.*` frames of the SSE channel (ARCHITECTURE §8) */
export type RunEvent = Extract<ServerEvent, { run: RunDto }>;

export interface RunFailure {
	runId: string;
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

function nextActiveRunId(state: RunState, event: RunEvent): string | null {
	if (event.run.lane !== ANALYSIS_LANE) {
		return state.activeRunId;
	}
	if (event.type === "run.queued" || event.type === "run.started") {
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
	const error = event.run.error;
	return {
		runId: event.run.id,
		// a failed run with no error block is a server bug, not a new reason:
		// `internal` is what the copy table already answers for it
		reason: error?.reason ?? "internal",
		message: error?.message ?? "The analysis failed.",
	};
}
