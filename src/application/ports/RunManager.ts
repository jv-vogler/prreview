import type {
	RunProgress,
	RunProgressUpdate,
} from "../../domain/analysis/RunProgress";
import type { EngineErrorReason } from "../../domain/errors/EngineError";

/**
 * The two-lane run manager (ARCHITECTURE §7), implemented in
 * infrastructure/engine/runManager. In plain terms: it is the queue that keeps
 * at most one analysis and one chat turn talking to the agent at a time, so the
 * user can interrogate the diff while an analysis runs, and it is the third
 * error-handling edge (GUD-001) — an engine failure after the 202 becomes a
 * failed run, never an unhandled rejection.
 *
 * Runs are ephemeral on purpose: a restart does not resume them, only session
 * data survives.
 */
export interface RunManager {
	/** returns immediately; the work runs in the background */
	enqueue(request: RunRequest): EnqueueResult;
	/**
	 * The lane's job saying what it is doing, so the UI can say it too.
	 *
	 * Silent on a run that has already settled or never existed: progress
	 * arriving after the result is a race the caller should not have to think
	 * about, and a late tool event must never resurrect a finished run.
	 */
	report(runId: string, update: RunProgressUpdate): void;
	/** false when no run has that id (already settled, or never existed) */
	cancel(runId: string): boolean;
	/** shutdown: stops every queued and running run in both lanes (SEC-002) */
	cancelAll(): void;
	get(runId: string): Run | undefined;
	/** every run this process knows about, oldest first */
	list(): Run[];
}

export type RunLane = "analysis" | "chat";

export type RunStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "timed-out";

export interface Run {
	id: string;
	lane: RunLane;
	/** the collapse key, and the stage a RunDto reports (M2: comprehension, chat) */
	taskType: string;
	status: RunStatus;
	queuedAt: string;
	startedAt?: string;
	endedAt?: string;
	error?: RunFailure;
	/** agent anchors that could not be placed and were dropped (TASK-032) */
	skippedAnchors?: number;
	/** what the run is doing, once it has done anything */
	progress?: RunProgress;
	/**
	 * How long this run may go **silent** before it is stopped. Not a wall
	 * clock: a run that keeps reporting keeps running, however long it takes.
	 *
	 * On the wire so the screen can say how much silence is left rather than
	 * leaving the reader to guess whether a quiet run has any end at all.
	 */
	idleTimeoutMs: number;
}

export interface RunFailure {
	/** an engine reason, or `internal` when the lane's own work threw */
	reason: EngineErrorReason | "internal";
	message: string;
}

/**
 * Every state transition is published (GUD-001). A timed-out run is published
 * as `run.failed` carrying `status: 'timed-out'` — §8's event list has no
 * separate timeout event, and the status already says what happened.
 */
export interface RunEvent {
	type: RunEventType;
	run: Run;
}

export type RunEventType =
	| "run.queued"
	| "run.started"
	| "run.progress"
	| "run.succeeded"
	| "run.failed"
	| "run.cancelled";

export interface RunRequest {
	lane: RunLane;
	taskType: string;
	/** overrides the lane's default silence budget from limits.ts */
	idleTimeoutMs?: number;
	job: RunJob;
}

/**
 * The lane's work. It reports failure by returning, not by throwing — a throw
 * is still contained and becomes `internal`, but a use-case that knows why the
 * run failed should say so.
 */
export type RunJob = (context: RunContext) => Promise<RunOutcome>;

export interface RunContext {
	runId: string;
	/** aborted by cancel() and by the lane's timeout; stop iterating the engine */
	signal: AbortSignal;
}

export type RunOutcome =
	| { ok: true; skippedAnchors?: number }
	| ({ ok: false } & RunFailure);

/**
 * A duplicate task type still queued collapses onto the same runId; one
 * already running conflicts, which the route turns into a 409 carrying
 * `existingRunId` — an ordinary negative outcome, not an error class.
 */
export type EnqueueResult =
	| { kind: "accepted"; runId: string }
	| { kind: "collapsed"; runId: string }
	| { kind: "conflict"; existingRunId: string };
