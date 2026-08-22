import { ulid } from "ulid";
import type { PublishEvent } from "../../application/ports/EventPublisher";
import type {
	RunJob,
	RunManager,
	RunOutcome,
	StartResult,
} from "../../application/ports/RunManager";
import type { Run, RunEventType, RunStatus } from "../../domain/review/Run";
import {
	applyRunProgress,
	EMPTY_RUN_PROGRESS,
	type RunProgressUpdate,
} from "../../domain/review/RunProgress";

/**
 * The old implementation's two-lane policy and fan-out semaphore are gone
 * on purpose (TASK-033) — there is one lane now, and a second start request
 * while one is active is simply a conflict, never a queue.
 */
export interface RunManagerOptions {
	/** every state transition goes out here */
	publish: PublishEvent;
}

/**
 * How often a running job's progress reaches the browser.
 *
 * An agent reading forty files emits forty tool events in a few seconds, and
 * forty SSE frames to move one line of text is waste. One frame every half
 * second still reads as live to a person, and the newest state is always
 * the one that gets sent — a coalesced frame is never a stale frame.
 */
const PROGRESS_PUBLISH_MS = 500;

const MS_PER_SECOND = 1000;

interface ActiveRun {
	run: Run;
	controller: AbortController;
	cancelRequested: boolean;
	timedOut: boolean;
	/** set while a coalesced progress frame is waiting to go out */
	progressTimer: NodeJS.Timeout | null;
	/** the silence clock; rearmed by every progress report */
	idleTimer: NodeJS.Timeout | null;
}

export function createRunManager(options: RunManagerOptions): RunManager {
	const { publish } = options;
	const runsById = new Map<string, ActiveRun>();
	// the most recently started run, kept even after it settles — a poll or a
	// page reload has to see a run's terminal state too, not just a live one
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
			// a queued progress frame published after the terminal one would put
			// the run back into "working" on every screen watching it
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
			// a throwing job must never wedge the manager
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

	function start(job: RunJob, idleTimeoutMs: number): StartResult {
		if (mostRecent !== null && !isSettled(mostRecent.run.status)) {
			return { kind: "conflict", existingRunId: mostRecent.run.id };
		}
		const entry: ActiveRun = {
			run: {
				id: ulid(),
				status: "queued",
				queuedAt: nowIso(),
				idleTimeoutMs,
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
		// deliberately not awaited: start() returns while the work runs, and
		// start_() contains every failure itself
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

	/**
	 * Cancellation travels through the abort signal: the job stops iterating
	 * the engine, and (per `buildReviewJob`) the abort listener calls the
	 * engine's own `stop()`, which sends SIGTERM and escalates to SIGKILL
	 * (SEC-002).
	 */
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

/** Callers get a copy: a run record handed out must not mutate under them. */
function snapshot(entry: ActiveRun): Run {
	return { ...entry.run };
}

function nowIso(): string {
	return new Date().toISOString();
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
