import type { RunDto } from "@dto/RunDto";
import { describe, expect, it } from "vitest";
import type { RunEvent, RunState } from "./runReducer";
import { initialRunState, reconcileRuns, runReducer } from "./runReducer";

function run(overrides: Partial<RunDto> = {}): RunDto {
	return {
		id: "run-1",
		stage: "comprehension",
		lane: "analysis",
		status: "queued",
		queuedAt: "2026-08-17T10:00:00.000Z",
		timeoutMs: 600_000,
		...overrides,
	};
}

function fold(events: readonly RunEvent[], from: RunState = initialRunState) {
	return events.reduce(runReducer, from);
}

describe("runReducer", () => {
	it("follows one successful analysis run from queue to result", () => {
		const state = fold([
			{ type: "run.queued", run: run() },
			{
				type: "run.started",
				run: run({ status: "running", startedAt: "2026-08-17T10:00:01.000Z" }),
			},
			{
				type: "run.succeeded",
				run: run({
					status: "succeeded",
					startedAt: "2026-08-17T10:00:01.000Z",
					endedAt: "2026-08-17T10:03:00.000Z",
					skippedAnchors: 2,
				}),
			},
		]);

		expect(state.activeRunId).toBeNull();
		expect(state.lastError).toBeNull();
		expect(state.byId["run-1"]?.status).toBe("succeeded");
		expect(state.byId["run-1"]?.skippedAnchors).toBe(2);
	});

	it("holds the active run while it is queued and while it runs", () => {
		const queued = fold([{ type: "run.queued", run: run() }]);
		expect(queued.activeRunId).toBe("run-1");

		const started = fold(
			[{ type: "run.started", run: run({ status: "running" }) }],
			queued,
		);
		expect(started.activeRunId).toBe("run-1");
	});

	it("records the failure reason and clears the active run", () => {
		const state = fold([
			{ type: "run.queued", run: run() },
			{
				type: "run.failed",
				run: run({
					status: "failed",
					error: { reason: "schema-violation", message: "unusable output" },
				}),
			},
		]);

		expect(state.activeRunId).toBeNull();
		expect(state.lastError).toEqual({
			runId: "run-1",
			stage: "comprehension",
			reason: "schema-violation",
			message: "unusable output",
		});
	});

	it("falls back to `internal` for a failed run with no error block", () => {
		const state = fold([
			{ type: "run.failed", run: run({ status: "failed" }) },
		]);
		expect(state.lastError?.reason).toBe("internal");
	});

	it("clears the previous failure when a new attempt is queued", () => {
		const failed = fold([
			{
				type: "run.failed",
				run: run({
					status: "failed",
					error: { reason: "timed-out", message: "took too long" },
				}),
			},
		]);
		const requeued = fold(
			[{ type: "run.queued", run: run({ id: "run-2" }) }],
			failed,
		);

		expect(requeued.lastError).toBeNull();
		expect(requeued.activeRunId).toBe("run-2");
	});

	it("clears the active run on cancellation", () => {
		const state = fold([
			{ type: "run.queued", run: run() },
			{ type: "run.cancelled", run: run({ status: "cancelled" }) },
		]);
		expect(state.activeRunId).toBeNull();
		expect(state.byId["run-1"]?.status).toBe("cancelled");
	});

	it("records chat-lane runs without ever making one the active analysis", () => {
		const state = fold([
			{ type: "run.queued", run: run() },
			{
				type: "run.queued",
				run: run({ id: "chat-1", stage: "chat", lane: "chat" }),
			},
			{
				type: "run.failed",
				run: run({
					id: "chat-1",
					stage: "chat",
					lane: "chat",
					status: "failed",
					error: { reason: "crashed", message: "the agent died" },
				}),
			},
		]);

		expect(state.activeRunId).toBe("run-1");
		expect(state.lastError).toBeNull();
		expect(state.byId["chat-1"]?.lane).toBe("chat");
	});

	it("leaves the active run alone when another analysis run settles", () => {
		const state = fold([
			{ type: "run.queued", run: run({ id: "run-2" }) },
			{ type: "run.succeeded", run: run({ id: "run-1", status: "succeeded" }) },
		]);
		expect(state.activeRunId).toBe("run-2");
	});
});

/**
 * The backstop against the failure that made the tool feel broken: the SSE
 * channel drops a frame, the client keeps showing "Running…" for a run the
 * server finished minutes ago, and the only way to find out is a terminal.
 */
describe("reconcileRuns", () => {
	it("adopts a run in flight that this client never saw start", () => {
		const state = reconcileRuns(initialRunState, [
			run({ status: "running", startedAt: "2026-08-17T10:00:01.000Z" }),
		]);

		expect(state.activeRunId).toBe("run-1");
	});

	it("clears an active run the server says has finished", () => {
		const running = fold([
			{ type: "run.started", run: run({ status: "running" }) },
		]);
		expect(running.activeRunId).toBe("run-1");

		const state = reconcileRuns(running, [
			run({ status: "succeeded", endedAt: "2026-08-17T10:04:00.000Z" }),
		]);

		expect(state.activeRunId).toBeNull();
	});

	/** a failure whose `run.failed` frame was lost still has to reach the reader */
	it("surfaces a failure it learns about only from the snapshot", () => {
		const running = fold([
			{ type: "run.started", run: run({ status: "running" }) },
		]);

		const state = reconcileRuns(running, [
			run({
				status: "failed",
				error: { reason: "api-error", message: "HTTP 429: rate limited" },
			}),
		]);

		expect(state.activeRunId).toBeNull();
		expect(state.lastError).toMatchObject({
			reason: "api-error",
			message: "HTTP 429: rate limited",
		});
	});

	it("leaves a live run alone", () => {
		const running = fold([
			{ type: "run.started", run: run({ status: "running" }) },
		]);
		const state = reconcileRuns(running, [run({ status: "running" })]);

		expect(state.activeRunId).toBe("run-1");
		expect(state.lastError).toBeNull();
	});

	/** a chat turn running in the background is not the analysis the tray is about */
	it("does not adopt a chat run as the active analysis", () => {
		const state = reconcileRuns(initialRunState, [
			run({ id: "chat-1", lane: "chat", stage: "chat", status: "running" }),
		]);

		expect(state.activeRunId).toBeNull();
	});
});

describe("runReducer progress frames", () => {
	it("keeps the run active and carries what it is doing", () => {
		const state = fold([
			{ type: "run.started", run: run({ status: "running" }) },
			{
				type: "run.progress",
				run: run({
					status: "running",
					progress: {
						activity: "Reading src/a.ts",
						toolCalls: 12,
						lastActivityAt: "2026-08-17T10:02:00.000Z",
					},
				}),
			},
		]);

		expect(state.activeRunId).toBe("run-1");
		expect(state.byId["run-1"]?.progress?.toolCalls).toBe(12);
	});
});
