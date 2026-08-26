import type { Run, RunFailure } from "../../domain/run/Run";
import type { RunProgressUpdate } from "../../domain/run/RunProgress";

/**
 * At most one review run at a time (TASK-033): one runId, one cancel, one
 * abort signal. There is one lane now — a second start request while one is
 * active is a conflict, never a queue. A rework (TASK-048) shares this same
 * lane rather than getting one of its own — `meta` is how it tags itself.
 */
export interface RunManager {
	/** returns immediately; the work runs in the background */
	start(job: RunJob, idleTimeoutMs: number, meta?: RunMeta): StartResult;
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

/**
 * `result` only ever carries something on a `kind: "rework"` run — the
 * proposed body — but it is typed here rather than on a rework-specific
 * outcome shape, because `RunManager` itself stays generic over job kind.
 */
export type RunOutcome =
	| { ok: true; result?: string }
	| ({ ok: false } & RunFailure);

export type RunMeta =
	| { kind: "review" }
	| { kind: "rework"; commentId: string };

export type StartResult =
	| { kind: "started"; runId: string }
	| { kind: "conflict"; existingRunId: string };
