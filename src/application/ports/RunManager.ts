import type { Run, RunJob, RunMeta, StartResult } from "../../domain/run/Run";
import type { RunProgressUpdate } from "../../domain/run/RunProgress";

export interface RunManager {
	start(job: RunJob, idleTimeoutMs: number, meta?: RunMeta): StartResult;
	report(runId: string, update: RunProgressUpdate): void;
	cancel(runId: string): boolean;
	cancelAll(): void;
	get(runId: string): Run | undefined;
	current(): Run | null;
}
