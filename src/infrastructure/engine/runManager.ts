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

interface QueuedRun {
	run: Run;
	job: RunJob;
	timeoutMs: number;
	controller: AbortController;
	cancelRequested: boolean;
	timedOut: boolean;
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

		const entry: QueuedRun = {
			run: {
				id: ulid(),
				lane: request.lane,
				taskType: request.taskType,
				status: "queued",
				queuedAt: nowIso(),
			},
			job: request.job,
			timeoutMs: request.timeoutMs ?? timeoutMsByLane[request.lane],
			controller: new AbortController(),
			cancelRequested: false,
			timedOut: false,
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

	function transition(
		entry: QueuedRun,
		status: RunStatus,
		eventType: RunEventType,
	): void {
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
