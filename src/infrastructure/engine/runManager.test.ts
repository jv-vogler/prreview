import { describe, expect, it } from "vitest";
import type {
	Run,
	RunEvent,
	RunLane,
	RunManager,
	RunOutcome,
} from "../../application/ports/RunManager";
import { createRunManager } from "./runManager";

const LANE_TIMEOUTS: Record<RunLane, number> = { analysis: 1000, chat: 1000 };

interface Harness {
	manager: RunManager;
	events: RunEvent[];
	types: () => string[];
}

function harness(timeouts = LANE_TIMEOUTS): Harness {
	const events: RunEvent[] = [];
	const manager = createRunManager({
		publish: (event) => events.push(event),
		timeoutMsByLane: timeouts,
	});
	return { manager, events, types: () => events.map((event) => event.type) };
}

/** a job the test drives: it reports when it started and waits to be released */
function controllableJob(outcome: RunOutcome = { ok: true }) {
	let release!: () => void;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	let startedResolve!: () => void;
	const started = new Promise<void>((resolve) => {
		startedResolve = resolve;
	});
	let abortedAtRelease = false;
	return {
		started,
		release,
		wasAborted: () => abortedAtRelease,
		job: async (context: { signal: AbortSignal }): Promise<RunOutcome> => {
			startedResolve();
			await released;
			abortedAtRelease = context.signal.aborted;
			return outcome;
		},
	};
}

/** a job that never finishes on its own — only an abort ends it */
function abortAwareJob(outcome: RunOutcome = { ok: true }) {
	let startedResolve!: () => void;
	const started = new Promise<void>((resolve) => {
		startedResolve = resolve;
	});
	return {
		started,
		job: (context: { signal: AbortSignal }): Promise<RunOutcome> => {
			startedResolve();
			return new Promise((resolve) => {
				context.signal.addEventListener("abort", () => resolve(outcome), {
					once: true,
				});
			});
		},
	};
}

function statusOf(manager: RunManager, runId: string): Run["status"] {
	const run = manager.get(runId);
	if (run === undefined) {
		throw new Error(`no run ${runId}`);
	}
	return run.status;
}

async function settled(manager: RunManager, runId: string): Promise<Run> {
	const deadline = Date.now() + 1000;
	while (Date.now() < deadline) {
		const run = manager.get(runId);
		if (
			run !== undefined &&
			run.status !== "queued" &&
			run.status !== "running"
		) {
			return run;
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`run ${runId} never settled`);
}

describe("runManager lifecycle", () => {
	it("takes a run from queued through running to succeeded, publishing each step", async () => {
		const { manager, events, types } = harness();
		const work = controllableJob();

		const accepted = manager.enqueue({
			lane: "analysis",
			taskType: "comprehension",
			job: work.job,
		});
		expect(accepted).toEqual({ kind: "accepted", runId: expect.any(String) });
		if (accepted.kind !== "accepted") {
			throw new Error("expected an accepted run");
		}

		await work.started;
		expect(statusOf(manager, accepted.runId)).toBe("running");
		work.release();
		const run = await settled(manager, accepted.runId);

		expect(run.status).toBe("succeeded");
		expect(run.startedAt).toBeDefined();
		expect(run.endedAt).toBeDefined();
		expect(types()).toEqual(["run.queued", "run.started", "run.succeeded"]);
		expect(events.every((event) => event.run.id === accepted.runId)).toBe(true);
	});

	it("records a reported failure with its reason and message", async () => {
		const { manager, types } = harness();
		const enqueued = manager.enqueue({
			lane: "analysis",
			taskType: "comprehension",
			job: async () => ({
				ok: false,
				reason: "crashed",
				message: "claude died: exit 9",
			}),
		});
		if (enqueued.kind !== "accepted") {
			throw new Error("expected an accepted run");
		}

		const run = await settled(manager, enqueued.runId);
		expect(run.status).toBe("failed");
		expect(run.error).toEqual({
			reason: "crashed",
			message: "claude died: exit 9",
		});
		expect(types()).toEqual(["run.queued", "run.started", "run.failed"]);
	});

	it("carries skippedAnchors from the job onto the run", async () => {
		const { manager } = harness();
		const enqueued = manager.enqueue({
			lane: "analysis",
			taskType: "comprehension",
			job: async () => ({ ok: true, skippedAnchors: 2 }),
		});
		if (enqueued.kind !== "accepted") {
			throw new Error("expected an accepted run");
		}
		expect((await settled(manager, enqueued.runId)).skippedAnchors).toBe(2);
	});

	it("contains a throwing job: the run fails as internal and the lane keeps draining", async () => {
		const { manager } = harness();
		const thrower = manager.enqueue({
			lane: "analysis",
			taskType: "comprehension",
			job: async () => {
				throw new Error("the use-case blew up");
			},
		});
		if (thrower.kind !== "accepted") {
			throw new Error("expected an accepted run");
		}
		const failed = await settled(manager, thrower.runId);
		expect(failed.status).toBe("failed");
		expect(failed.error).toEqual({
			reason: "internal",
			message: "the use-case blew up",
		});

		// the lane is not wedged: the next run still gets to run
		const next = manager.enqueue({
			lane: "analysis",
			taskType: "comprehension",
			job: async () => ({ ok: true }),
		});
		if (next.kind !== "accepted") {
			throw new Error("expected the lane to accept the next run");
		}
		expect((await settled(manager, next.runId)).status).toBe("succeeded");
	});
});

describe("runManager queueing", () => {
	it("collapses a duplicate analysis task that is still queued", async () => {
		const { manager } = harness();
		const blocker = controllableJob();
		const first = manager.enqueue({
			lane: "analysis",
			taskType: "other-stage",
			job: blocker.job,
		});
		await blocker.started;

		const queued = manager.enqueue({
			lane: "analysis",
			taskType: "comprehension",
			job: async () => ({ ok: true }),
		});
		const duplicate = manager.enqueue({
			lane: "analysis",
			taskType: "comprehension",
			job: async () => ({ ok: true }),
		});

		expect(queued.kind).toBe("accepted");
		expect(duplicate).toEqual({
			kind: "collapsed",
			runId: queued.kind === "accepted" ? queued.runId : "",
		});
		blocker.release();
		if (first.kind !== "accepted") {
			throw new Error("expected an accepted run");
		}
		await settled(manager, first.runId);
	});

	it("conflicts on an analysis task that is already running, naming the run to cancel", async () => {
		const { manager } = harness();
		const running = controllableJob();
		const first = manager.enqueue({
			lane: "analysis",
			taskType: "comprehension",
			job: running.job,
		});
		await running.started;
		if (first.kind !== "accepted") {
			throw new Error("expected an accepted run");
		}

		expect(
			manager.enqueue({
				lane: "analysis",
				taskType: "comprehension",
				job: async () => ({ ok: true }),
			}),
		).toEqual({ kind: "conflict", existingRunId: first.runId });

		running.release();
		await settled(manager, first.runId);
	});

	it("queues chat turns instead of collapsing them: a second question is a second question", async () => {
		const { manager } = harness();
		const firstTurn = controllableJob();
		const first = manager.enqueue({
			lane: "chat",
			taskType: "chat",
			job: firstTurn.job,
		});
		await firstTurn.started;

		const second = manager.enqueue({
			lane: "chat",
			taskType: "chat",
			job: async () => ({ ok: true }),
		});
		expect(second.kind).toBe("accepted");
		if (first.kind !== "accepted" || second.kind !== "accepted") {
			throw new Error("expected two accepted runs");
		}
		expect(statusOf(manager, second.runId)).toBe("queued");

		firstTurn.release();
		expect((await settled(manager, second.runId)).status).toBe("succeeded");
	});

	it("runs one child per lane and lets the chat lane work while analysis is busy", async () => {
		const { manager } = harness();
		const analysis = controllableJob();
		const chat = controllableJob();
		const queuedBehindAnalysis = controllableJob();

		const analysisRun = manager.enqueue({
			lane: "analysis",
			taskType: "comprehension",
			job: analysis.job,
		});
		const chatRun = manager.enqueue({
			lane: "chat",
			taskType: "chat",
			job: chat.job,
		});
		const secondAnalysis = manager.enqueue({
			lane: "analysis",
			taskType: "other-stage",
			job: queuedBehindAnalysis.job,
		});
		await Promise.all([analysis.started, chat.started]);

		const running = manager.list().filter((run) => run.status === "running");
		expect(running.map((run) => run.lane).sort()).toEqual(["analysis", "chat"]);
		expect(running).toHaveLength(2);
		if (secondAnalysis.kind !== "accepted") {
			throw new Error("expected an accepted run");
		}
		expect(statusOf(manager, secondAnalysis.runId)).toBe("queued");

		analysis.release();
		chat.release();
		await queuedBehindAnalysis.started;
		queuedBehindAnalysis.release();
		if (analysisRun.kind !== "accepted" || chatRun.kind !== "accepted") {
			throw new Error("expected accepted runs");
		}
		await Promise.all([
			settled(manager, analysisRun.runId),
			settled(manager, chatRun.runId),
			settled(manager, secondAnalysis.runId),
		]);
		expect(manager.list()).toHaveLength(3);
	});
});

describe("runManager cancellation", () => {
	it("aborts a running job's signal and reports the run cancelled", async () => {
		const { manager, types } = harness();
		const work = abortAwareJob();
		const enqueued = manager.enqueue({
			lane: "analysis",
			taskType: "comprehension",
			job: work.job,
		});
		if (enqueued.kind !== "accepted") {
			throw new Error("expected an accepted run");
		}
		await work.started;

		expect(manager.cancel(enqueued.runId)).toBe(true);
		const run = await settled(manager, enqueued.runId);
		expect(run.status).toBe("cancelled");
		expect(run.error).toBeUndefined();
		expect(types()).toEqual(["run.queued", "run.started", "run.cancelled"]);
	});

	it("cancels a queued run without ever starting it", async () => {
		const { manager } = harness();
		const blocker = controllableJob();
		const first = manager.enqueue({
			lane: "analysis",
			taskType: "comprehension",
			job: blocker.job,
		});
		await blocker.started;

		let secondStarted = false;
		const second = manager.enqueue({
			lane: "analysis",
			taskType: "other-stage",
			job: async () => {
				secondStarted = true;
				return { ok: true };
			},
		});
		if (second.kind !== "accepted" || first.kind !== "accepted") {
			throw new Error("expected accepted runs");
		}

		expect(manager.cancel(second.runId)).toBe(true);
		expect(statusOf(manager, second.runId)).toBe("cancelled");
		blocker.release();
		await settled(manager, first.runId);
		expect(secondStarted).toBe(false);
	});

	it("cancelling a settled or unknown run reports false", async () => {
		const { manager } = harness();
		const enqueued = manager.enqueue({
			lane: "analysis",
			taskType: "comprehension",
			job: async () => ({ ok: true }),
		});
		if (enqueued.kind !== "accepted") {
			throw new Error("expected an accepted run");
		}
		await settled(manager, enqueued.runId);

		expect(manager.cancel(enqueued.runId)).toBe(false);
		expect(manager.cancel("no-such-run")).toBe(false);
	});

	it("cancelAll stops every live run, which is what shutdown needs", async () => {
		const { manager } = harness();
		const analysis = abortAwareJob();
		const chat = abortAwareJob();
		const analysisRun = manager.enqueue({
			lane: "analysis",
			taskType: "comprehension",
			job: analysis.job,
		});
		const chatRun = manager.enqueue({
			lane: "chat",
			taskType: "chat",
			job: chat.job,
		});
		await Promise.all([analysis.started, chat.started]);

		manager.cancelAll();
		if (analysisRun.kind !== "accepted" || chatRun.kind !== "accepted") {
			throw new Error("expected accepted runs");
		}
		expect((await settled(manager, analysisRun.runId)).status).toBe(
			"cancelled",
		);
		expect((await settled(manager, chatRun.runId)).status).toBe("cancelled");
	});
});

describe("runManager timeout", () => {
	it("aborts a run that passes its budget and reports it timed out", async () => {
		const { manager, types } = harness({ analysis: 20, chat: 20 });
		const work = abortAwareJob();
		const enqueued = manager.enqueue({
			lane: "analysis",
			taskType: "comprehension",
			job: work.job,
		});
		if (enqueued.kind !== "accepted") {
			throw new Error("expected an accepted run");
		}

		const run = await settled(manager, enqueued.runId);
		expect(run.status).toBe("timed-out");
		expect(run.error?.reason).toBe("timed-out");
		// §8 has no timeout event: a timed-out run is published as failed
		expect(types()).toEqual(["run.queued", "run.started", "run.failed"]);
	});

	it("uses the request's own budget over the lane default", async () => {
		const { manager } = harness({ analysis: 60_000, chat: 60_000 });
		const work = abortAwareJob();
		const enqueued = manager.enqueue({
			lane: "analysis",
			taskType: "comprehension",
			timeoutMs: 20,
			job: work.job,
		});
		if (enqueued.kind !== "accepted") {
			throw new Error("expected an accepted run");
		}
		expect((await settled(manager, enqueued.runId)).status).toBe("timed-out");
	});

	it("does not fire the timeout for a run that finished in time", async () => {
		const { manager } = harness({ analysis: 60_000, chat: 60_000 });
		const enqueued = manager.enqueue({
			lane: "analysis",
			taskType: "comprehension",
			job: async () => ({ ok: true }),
		});
		if (enqueued.kind !== "accepted") {
			throw new Error("expected an accepted run");
		}
		expect((await settled(manager, enqueued.runId)).status).toBe("succeeded");
	});
});
