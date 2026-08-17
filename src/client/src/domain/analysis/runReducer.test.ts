import type { RunDto } from "@dto/RunDto";
import { describe, expect, it } from "vitest";
import type { RunEvent, RunState } from "./runReducer";
import { initialRunState, runReducer } from "./runReducer";

function run(overrides: Partial<RunDto> = {}): RunDto {
	return {
		id: "run-1",
		stage: "comprehension",
		lane: "analysis",
		status: "queued",
		queuedAt: "2026-08-17T10:00:00.000Z",
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
