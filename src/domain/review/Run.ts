import type { EngineErrorReason } from "../errors/EngineError";
import type { RunProgress } from "./RunProgress";

/**
 * One review run, end to end. Runs are ephemeral on purpose (TASK-033: at
 * most one at a time, one runId, one cancel): a restart does not resume
 * them, only the saved review artifact survives.
 */
export type RunStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "timed-out";

export interface Run {
	id: string;
	status: RunStatus;
	queuedAt: string;
	startedAt?: string;
	endedAt?: string;
	error?: RunFailure;
	/** what the run is doing, once it has done anything */
	progress?: RunProgress;
	/**
	 * How long this run may go **silent** before it is stopped. Not a wall
	 * clock: a run that keeps reporting keeps running, however long it takes.
	 */
	idleTimeoutMs: number;
}

export interface RunFailure {
	/** an engine reason, or `internal` when the run's own code threw */
	reason: EngineErrorReason | "internal";
	message: string;
}

export type RunEventType =
	| "run.queued"
	| "run.started"
	| "run.progress"
	| "run.succeeded"
	| "run.failed"
	| "run.cancelled";

/** Every state transition is published, so the browser never has to poll to know. */
export interface RunEvent {
	type: RunEventType;
	run: Run;
}
