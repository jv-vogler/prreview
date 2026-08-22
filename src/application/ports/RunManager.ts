import type { Run, RunFailure } from "../../domain/review/Run";
import type { RunProgressUpdate } from "../../domain/review/RunProgress";

/**
 * At most one review run at a time (TASK-033): one runId, one cancel, one
 * abort signal. There is one lane now — a second start request while one is
 * active is a conflict, never a queue.
 */
export interface RunManager {
	/** returns immediately; the work runs in the background */
	start(job: RunJob, idleTimeoutMs: number): StartResult;
	/**
	 * The job saying what it is doing, so the UI can say it too. Silent on a
	 * run that has already settled or never existed: progress arriving after
	 * the result is a race the caller should not have to think about.
	 */
	report(runId: string, update: RunProgressUpdate): void;
	/** false when no run has that id (already settled, or never existed) */
	cancel(runId: string): boolean;
	/** shutdown: stops the run, if one is active */
	cancelAll(): void;
	get(runId: string): Run | undefined;
	/** the run currently queued or running, if any */
	current(): Run | null;
}

export type RunJob = (context: RunContext) => Promise<RunOutcome>;

export interface RunContext {
	runId: string;
	/** aborted by cancel(); the job should stop iterating the engine on this */
	signal: AbortSignal;
}

export type RunOutcome = { ok: true } | ({ ok: false } & RunFailure);

export type StartResult =
	| { kind: "started"; runId: string }
	| { kind: "conflict"; existingRunId: string };
