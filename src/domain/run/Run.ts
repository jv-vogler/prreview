import type { EngineErrorReason } from "../errors/EngineError";
import type { RunProgress } from "./RunProgress";

export type RunStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "timed-out";

export type RunKind = "review" | "rework";

export interface Run {
	id: string;
	kind: RunKind;
	status: RunStatus;
	queuedAt: string;
	startedAt?: string;
	endedAt?: string;
	error?: RunFailure;

	progress?: RunProgress;

	idleTimeoutMs: number;

	findingId?: string;

	result?: string;
}

export interface RunFailure {
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

export interface RunEvent {
	type: RunEventType;
	run: Run;
}
