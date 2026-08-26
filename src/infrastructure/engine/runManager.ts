import { ulid } from "ulid";
import type { PublishEvent } from "../../application/ports/EventPublisher";
import type {
	RunJob,
	RunManager,
	RunMeta,
	RunOutcome,
	StartResult,
} from "../../application/ports/RunManager";
import type { Run, RunEventType, RunStatus } from "../../domain/run/Run";
import {
	applyRunProgress,
	EMPTY_RUN_PROGRESS,
	type RunProgressUpdate,
} from "../../domain/run/RunProgress";

export interface RunManagerOptions {
	publish: PublishEvent;
}

const PROGRESS_PUBLISH_MS = 500;

const MS_PER_SECOND = 1000;

interface ActiveRun {
	run: Run;
	controller: AbortController;
	cancelRequested: boolean;
	timedOut: boolean;
	progressTimer: NodeJS.Timeout | null;
	idleTimer: NodeJS.Timeout | null;
}

export function createRunManager(options: RunManagerOptions): RunManager {
	const { publish } = options;
	const runsById = new Map<string, ActiveRun>();

	let mostRecent: ActiveRun | null = null;

	function armIdleClock(entry: ActiveRun): void {
		if (entry.idleTimer !== null) {
			clearTimeout(entry.idleTimer);
		}
		entry.idleTimer = setTimeout(() => {
			entry.timedOut = true;
			entry.controller.abort();
		}, entry.run.idleTimeoutMs);
		entry.idleTimer.unref?.();
	}

	function disarmIdleClock(entry: ActiveRun): void {
		if (entry.idleTimer !== null) {
			clearTimeout(entry.idleTimer);
			entry.idleTimer = null;
		}
	}

	function transition(
		entry: ActiveRun,
		status: RunStatus,
		eventType: RunEventType,
	): void {
		if (entry.progressTimer !== null) {
			clearTimeout(entry.progressTimer);
			entry.progressTimer = null;
		}
		entry.run.status = status;
		if (status === "running") {
			entry.run.startedAt = nowIso();
		} else {
			entry.run.endedAt = nowIso();
		}
		publish({ type: eventType, run: snapshot(entry) });
	}

	function settle(entry: ActiveRun, outcome: RunOutcome): void {
		if (entry.cancelRequested) {
			transition(entry, "cancelled", "run.cancelled");
			return;
		}
		if (entry.timedOut) {
			entry.run.error = {
				reason: "timed-out",
				message: `The review reported nothing for ${Math.round(entry.run.idleTimeoutMs / MS_PER_SECOND)}s and was stopped.`,
			};
			transition(entry, "timed-out", "run.failed");
			return;
		}
		if (outcome.ok) {
			if (outcome.result !== undefined) {
				entry.run.result = outcome.result;
			}
			transition(entry, "succeeded", "run.succeeded");
			return;
		}
		entry.run.error = { reason: outcome.reason, message: outcome.message };
		transition(entry, "failed", "run.failed");
	}

	async function runJob(entry: ActiveRun, job: RunJob): Promise<RunOutcome> {
		try {
			return await job({
				runId: entry.run.id,
				signal: entry.controller.signal,
			});
		} catch (error) {
			return { ok: false, reason: "internal", message: describeError(error) };
		}
	}

	async function start_(entry: ActiveRun, job: RunJob): Promise<void> {
		transition(entry, "running", "run.started");
		armIdleClock(entry);

		const outcome = await runJob(entry, job);
		disarmIdleClock(entry);
		settle(entry, outcome);
	}

	function start(
		job: RunJob,
		idleTimeoutMs: number,
		meta: RunMeta = { kind: "review" },
	): StartResult {
		if (mostRecent !== null && !isSettled(mostRecent.run.status)) {
			return { kind: "conflict", existingRunId: mostRecent.run.id };
		}
		const entry: ActiveRun = {
			run: {
				id: ulid(),
				status: "queued",
				queuedAt: nowIso(),
				idleTimeoutMs,
				...meta,
			},
			controller: new AbortController(),
			cancelRequested: false,
			timedOut: false,
			progressTimer: null,
			idleTimer: null,
		};
		runsById.set(entry.run.id, entry);
		mostRecent = entry;
		publish({ type: "run.queued", run: snapshot(entry) });
		void start_(entry, job);
		return { kind: "started", runId: entry.run.id };
	}

	function report(runId: string, update: RunProgressUpdate): void {
		const entry = runsById.get(runId);
		if (entry === undefined || isSettled(entry.run.status)) {
			return;
		}
		if (entry.run.status === "running") {
			armIdleClock(entry);
		}
		entry.run.progress = applyRunProgress(
			entry.run.progress ?? EMPTY_RUN_PROGRESS,
			update,
			nowIso(),
		);
		if (entry.progressTimer !== null) {
			return;
		}
		entry.progressTimer = setTimeout(() => {
			entry.progressTimer = null;
			if (!isSettled(entry.run.status)) {
				publish({ type: "run.progress", run: snapshot(entry) });
			}
		}, PROGRESS_PUBLISH_MS);
		entry.progressTimer.unref?.();
	}

	function cancel(runId: string): boolean {
		const entry = runsById.get(runId);
		if (entry === undefined || isSettled(entry.run.status)) {
			return false;
		}
		entry.cancelRequested = true;
		entry.controller.abort();
		return true;
	}

	return {
		start,
		report,
		cancel,
		cancelAll: () => {
			if (mostRecent !== null && !isSettled(mostRecent.run.status)) {
				cancel(mostRecent.run.id);
			}
		},
		get: (runId) => {
			const entry = runsById.get(runId);
			return entry === undefined ? undefined : snapshot(entry);
		},
		current: () => (mostRecent === null ? null : snapshot(mostRecent)),
	};
}

function isSettled(status: RunStatus): boolean {
	return status !== "queued" && status !== "running";
}

function snapshot(entry: ActiveRun): Run {
	return { ...entry.run };
}

function nowIso(): string {
	return new Date().toISOString();
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
