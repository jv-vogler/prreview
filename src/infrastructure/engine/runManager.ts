import { ulid } from "ulid";
import type {
	EnqueueResult,
	Run,
	RunEvent,
	RunEventType,
	RunJob,
	RunLane,
	RunManager,
	RunOutcome,
	RunRequest,
	RunStatus,
} from "../../application/ports/RunManager";
import type { RunProgressUpdate } from "../../domain/analysis/RunProgress";
import {
	applyRunProgress,
	EMPTY_RUN_PROGRESS,
} from "../../domain/analysis/RunProgress";

/**
 * The two lanes of ARCHITECTURE §7, at most two `claude` children alive: an
 * analysis lane and a chat lane, each a FIFO with concurrency 1.
 *
 * How the lanes differ, and why. The analysis lane is single-flight: asking for
 * the same stage twice is one request, so a duplicate still queued collapses
 * onto the same run and a duplicate already running conflicts — the UI renders
 * that as "cancel and re-run". The chat lane is a plain FIFO: a second question
 * is a second question, and collapsing or rejecting it would drop what the user
 * typed.
 */
const LANE_POLICY: Record<RunLane, "single-flight" | "fifo"> = {
	analysis: "single-flight",
	chat: "fifo",
};

export interface RunManagerOptions {
	/** every state transition goes out here (GUD-001) */
	publish: (event: RunEvent) => void;
	/**
	 * Default budget per lane, injected by the composition root from
	 * application/analysis/limits.ts so the timeouts stay in one place without
	 * infrastructure reaching up into a use-case module.
	 */
	timeoutMsByLane: Record<RunLane, number>;
}

/**
 * How often a running job's progress reaches the browser.
 *
 * An agent reading forty files emits forty tool events in a few seconds, and
 * forty SSE frames to move one line of text is waste. One frame every half
 * second still reads as live to a person, and the newest state is always the
 * one that gets sent — a coalesced frame is never a stale frame.
 */
const PROGRESS_PUBLISH_MS = 500;

interface QueuedRun {
	run: Run;
	job: RunJob;
	timeoutMs: number;
	controller: AbortController;
	cancelRequested: boolean;
	timedOut: boolean;
	/** set while a coalesced progress frame is waiting to go out */
	progressTimer: NodeJS.Timeout | null;
}

interface Lane {
	queue: QueuedRun[];
	active: QueuedRun | null;
}

export function createRunManager(options: RunManagerOptions): RunManager {
	const { publish, timeoutMsByLane } = options;
	const lanes: Record<RunLane, Lane> = {
		analysis: { queue: [], active: null },
		chat: { queue: [], active: null },
	};
	/** insertion-ordered, so list() is oldest first */
	const runsById = new Map<string, QueuedRun>();

	function enqueue(request: RunRequest): EnqueueResult {
		const lane = lanes[request.lane];
		if (LANE_POLICY[request.lane] === "single-flight") {
			const conflict = sameTaskType(lane.active, request.taskType);
			if (conflict !== null) {
				return { kind: "conflict", existingRunId: conflict.run.id };
			}
			const queued = lane.queue.find(
				(entry) => entry.run.taskType === request.taskType,
			);
			if (queued !== undefined) {
				return { kind: "collapsed", runId: queued.run.id };
			}
		}

		const timeoutMs = request.timeoutMs ?? timeoutMsByLane[request.lane];
		const entry: QueuedRun = {
			run: {
				id: ulid(),
				lane: request.lane,
				taskType: request.taskType,
				status: "queued",
				queuedAt: nowIso(),
				timeoutMs,
			},
			job: request.job,
			timeoutMs,
			controller: new AbortController(),
			cancelRequested: false,
			timedOut: false,
			progressTimer: null,
		};
		runsById.set(entry.run.id, entry);
		lane.queue.push(entry);
		publish({ type: "run.queued", run: snapshot(entry) });
		pump(request.lane);
		return { kind: "accepted", runId: entry.run.id };
	}

	function pump(laneName: RunLane): void {
		const lane = lanes[laneName];
		if (lane.active !== null) {
			return;
		}
		const next = lane.queue.shift();
		if (next === undefined) {
			return;
		}
		lane.active = next;
		// deliberately not awaited: enqueue() returns while the work runs, and
		// start() contains every failure itself
		void start(laneName, next);
	}

	async function start(laneName: RunLane, entry: QueuedRun): Promise<void> {
		transition(entry, "running", "run.started");
		const timer = setTimeout(() => {
			entry.timedOut = true;
			entry.controller.abort();
		}, entry.timeoutMs);
		timer.unref();

		const outcome = await runJob(entry);
		clearTimeout(timer);
		settle(entry, outcome);

		lanes[laneName].active = null;
		pump(laneName);
	}

	async function runJob(entry: QueuedRun): Promise<RunOutcome> {
		try {
			return await entry.job({
				runId: entry.run.id,
				signal: entry.controller.signal,
			});
		} catch (error) {
			// a throwing lane must never wedge the manager (GUD-001): the run
			// fails, the lane drains, the process lives
			return { ok: false, reason: "internal", message: describeError(error) };
		}
	}

	function settle(entry: QueuedRun, outcome: RunOutcome): void {
		if (entry.cancelRequested) {
			transition(entry, "cancelled", "run.cancelled");
			return;
		}
		if (entry.timedOut) {
			entry.run.error = {
				reason: "timed-out",
				message: `The ${entry.run.taskType} run passed its ${entry.timeoutMs}ms budget and was stopped.`,
			};
			transition(entry, "timed-out", "run.failed");
			return;
		}
		if (outcome.ok) {
			if (outcome.skippedAnchors !== undefined) {
				entry.run.skippedAnchors = outcome.skippedAnchors;
			}
			transition(entry, "succeeded", "run.succeeded");
			return;
		}
		entry.run.error = { reason: outcome.reason, message: outcome.message };
		transition(entry, "failed", "run.failed");
	}

	/**
	 * Records what a running job is doing and lets the browser know.
	 *
	 * Two rules keep this from becoming a source of lies. A settled run is
	 * ignored, so a tool event arriving after the result cannot make a finished
	 * run look busy. And the frames are coalesced rather than dropped: the state
	 * published is always the newest one, so the line on screen matches what the
	 * agent is doing now, not what it was doing when the window opened.
	 */
	function report(runId: string, update: RunProgressUpdate): void {
		const entry = runsById.get(runId);
		if (entry === undefined || isSettled(entry.run.status)) {
			return;
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

	function transition(
		entry: QueuedRun,
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

	/**
	 * Cancellation travels through the abort signal: the lane's job stops
	 * iterating the engine, and the adapter's own teardown sends SIGTERM and
	 * escalates to SIGKILL after 5s (SEC-002). A run still queued never starts.
	 */
	function cancel(runId: string): boolean {
		const entry = runsById.get(runId);
		if (entry === undefined || isSettled(entry.run.status)) {
			return false;
		}
		entry.cancelRequested = true;
		if (entry.run.status === "queued") {
			const lane = lanes[entry.run.lane];
			lane.queue = lane.queue.filter((queued) => queued !== entry);
			transition(entry, "cancelled", "run.cancelled");
			return true;
		}
		entry.controller.abort();
		return true;
	}

	return {
		enqueue,
		report,
		cancel,
		cancelAll: () => {
			for (const entry of runsById.values()) {
				if (!isSettled(entry.run.status)) {
					cancel(entry.run.id);
				}
			}
		},
		get: (runId) => {
			const entry = runsById.get(runId);
			return entry === undefined ? undefined : snapshot(entry);
		},
		list: () => [...runsById.values()].map(snapshot),
	};
}

function sameTaskType(
	active: QueuedRun | null,
	taskType: string,
): QueuedRun | null {
	if (active === null || active.run.taskType !== taskType) {
		return null;
	}
	return active;
}

function isSettled(status: RunStatus): boolean {
	return status !== "queued" && status !== "running";
}

/** Callers get a copy: a run record handed out must not mutate under them. */
function snapshot(entry: QueuedRun): Run {
	return { ...entry.run };
}

function nowIso(): string {
	return new Date().toISOString();
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
