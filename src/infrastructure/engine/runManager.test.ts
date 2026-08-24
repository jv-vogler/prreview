import { describe, expect, it, vi } from "vitest";
import type { RunJob, RunManager } from "../../application/ports/RunManager";
import type { RunEvent } from "../../domain/review/Run";
import { createRunManager } from "./runManager";

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

describe("createRunManager", () => {
	it("starts a run and publishes its lifecycle", () => {
		const events: RunEvent[] = [];
		const manager = createRunManager({
			publish: (event) => events.push(event),
		});
		const job: RunJob = async () => ({ ok: true });

		const result = manager.start(job, 10_000);
		expect(result.kind).toBe("started");
		expect(events[0]).toMatchObject({ type: "run.queued" });
	});

	it("rejects a second start while one run is active (TASK-033)", () => {
		const manager = createRunManager({ publish: () => {} });
		const gate = deferred<void>();
		const job: RunJob = () => gate.promise.then(() => ({ ok: true }));

		const first = manager.start(job, 10_000);
		const second = manager.start(job, 10_000);

		expect(first.kind).toBe("started");
		expect(second).toEqual({
			kind: "conflict",
			existingRunId: (first as { runId: string }).runId,
		});
		gate.resolve();
	});

	it("keeps reporting the terminal state after the run settles, for a poll or reload", async () => {
		const manager = createRunManager({ publish: () => {} });
		const { runId } = manager.start(async () => ({ ok: true }), 10_000) as {
			runId: string;
		};
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(manager.current()).toMatchObject({ id: runId, status: "succeeded" });
	});

	it("allows a new run once the previous one has settled", async () => {
		const manager = createRunManager({ publish: () => {} });
		const first = manager.start(async () => ({ ok: true }), 10_000);
		await new Promise((resolve) => setTimeout(resolve, 10));

		const second = manager.start(async () => ({ ok: true }), 10_000);
		expect(second.kind).toBe("started");
		expect((second as { runId: string }).runId).not.toBe(
			(first as { runId: string }).runId,
		);
	});

	it("cancel aborts the job's signal", async () => {
		const events: RunEvent[] = [];
		const manager = createRunManager({
			publish: (event) => events.push(event),
		});
		const gate = deferred<void>();
		let sawAbort = false;

		const job: RunJob = ({ signal }) => {
			signal.addEventListener("abort", () => {
				sawAbort = true;
			});
			return gate.promise.then(() => ({ ok: true }) as const);
		};

		const { runId } = manager.start(job, 10_000) as { runId: string };
		const cancelled = manager.cancel(runId);
		gate.resolve();
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(cancelled).toBe(true);
		expect(sawAbort).toBe(true);
		expect(events.at(-1)).toMatchObject({ type: "run.cancelled" });
	});

	it("returns false cancelling a run that already ended", async () => {
		const manager = createRunManager({ publish: () => {} });
		const { runId } = manager.start(async () => ({ ok: true }), 10_000) as {
			runId: string;
		};
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(manager.cancel(runId)).toBe(false);
	});

	it("never publishes progress after the terminal frame", async () => {
		vi.useFakeTimers();
		const events: RunEvent[] = [];
		const manager = createRunManager({
			publish: (event) => events.push(event),
		});
		let report!: (update: Parameters<RunManager["report"]>[1]) => void;

		const job: RunJob = ({ runId }) => {
			report = (update) => manager.report(runId, update);
			return Promise.resolve({ ok: true } as const);
		};
		manager.start(job, 10_000);
		await vi.runAllTimersAsync();

		report({ kind: "activity", activity: "Reading a.ts" });
		await vi.advanceTimersByTimeAsync(600);

		expect(events.some((event) => event.type === "run.progress")).toBe(false);
		vi.useRealTimers();
	});

	it("times out on silence, not on elapsed duration", async () => {
		vi.useFakeTimers();
		const events: RunEvent[] = [];
		const manager = createRunManager({
			publish: (event) => events.push(event),
		});
		const gate = deferred<{ ok: true }>();

		const job: RunJob = ({ runId, signal }) => {
			// touch the idle clock once, well inside the budget, then go silent
			manager.report(runId, { kind: "activity", activity: "Reading a.ts" });
			return new Promise((resolve) => {
				signal.addEventListener("abort", () => resolve({ ok: true }));
				gate.promise.then(resolve);
			});
		};

		manager.start(job, 1_000);
		await vi.advanceTimersByTimeAsync(500);
		// a touch inside the budget should have rearmed the clock; without a
		// second touch the run should still time out at 1000ms from the touch
		await vi.advanceTimersByTimeAsync(1_100);

		expect(events.at(-1)).toMatchObject({
			type: "run.failed",
			run: { status: "timed-out" },
		});
		vi.useRealTimers();
	});
});
