import type { Run, RunFailure } from "../../domain/run/Run";
import type { RunProgressUpdate } from "../../domain/run/RunProgress";

export interface RunManager {
	start(job: RunJob, idleTimeoutMs: number, meta?: RunMeta): StartResult;
	report(runId: string, update: RunProgressUpdate): void;
	cancel(runId: string): boolean;
	cancelAll(): void;
	get(runId: string): Run | undefined;
	current(): Run | null;
}

export type RunJob = (context: RunContext) => Promise<RunOutcome>;

export interface RunContext {
	runId: string;
	signal: AbortSignal;
}

export type RunOutcome =
	| { ok: true; result?: string }
	| ({ ok: false } & RunFailure);

export type RunMeta =
	| { kind: "review" }
	| { kind: "rework"; findingId: string };

export type StartResult =
	| { kind: "started"; runId: string }
	| { kind: "conflict"; existingRunId: string };
