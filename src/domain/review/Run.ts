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

/**
 * `review` is a full pass over the changeset; `rework` (TASK-048, TASK-049)
 * is a short, single-comment call sharing the same one-run-at-a-time lane —
 * there is no separate run-tracking system for it.
 */
export type RunKind = "review" | "rework";

export interface Run {
	id: string;
	kind: RunKind;
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
	/** only set on a `kind: "rework"` run — which comment it targets */
	commentId?: string;
	/**
	 * Only set on a `kind: "rework"` run once it succeeds: the proposed
	 * reworded body. Never written to the store on its own — the reader
	 * accepts or rejects it, and accepting goes through the same edit path
	 * any other edit does (TASK-046).
	 */
	result?: string;
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
