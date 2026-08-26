import { describe, expect, it } from "vitest";
import { FakeEngine } from "../../../test/helpers/FakeEngine";
import type { EngineEvent } from "../../domain/run/EngineEvent";
import type { RunProgressUpdate } from "../../domain/run/RunProgress";
import { runEngineTask } from "./runEngineTask";

const TASK = {
	jsonSchema: '{"type":"object"}',
	maxTurns: 5,
	idleTimeoutMs: 1000,
	systemContract: "contract",
	outputSchema: { parse: (value: unknown) => value },
};

const INPUT = { prompt: "do the thing", workspaceDir: "/tmp" };

const LABELS = {
	noResult: "The run ended with no result.",
	failed: "The run failed.",
};

function terminal(overrides: Record<string, unknown> = {}): EngineEvent {
	return {
		type: "result",
		ok: true,
		structuredOutput: { ok: true },
		text: null,
		sessionId: "s1",
		model: "m",
		numTurns: 1,
		costUsd: 0,
		durationMs: 1,
		stderrTail: "",
		...overrides,
	} as EngineEvent;
}

function harness(events: EngineEvent[], signal?: AbortSignal) {
	const engine = new FakeEngine();
	engine.events = events;
	const reported: { runId: string; update: RunProgressUpdate }[] = [];
	const deps = {
		engine,
		report: (runId: string, update: RunProgressUpdate) =>
			reported.push({ runId, update }),
	};
	const context = {
		runId: "run-1",
		signal: signal ?? new AbortController().signal,
	};
	return { engine, reported, deps, context };
}

describe("runEngineTask", () => {
	it("hands back the terminal event's structured output", async () => {
		const { deps, context } = harness([terminal()]);
		const result = await runEngineTask(deps, context, TASK, INPUT, LABELS);
		expect(result).toEqual({ ok: true, structuredOutput: { ok: true } });
	});

	it("calls a stream that never reaches a result a crash", async () => {
		const { deps, context } = harness([
			{ type: "tool", name: "Read", target: "src/a.ts" },
		]);
		const result = await runEngineTask(deps, context, TASK, INPUT, LABELS);
		expect(result).toEqual({
			ok: false,
			outcome: { ok: false, reason: "crashed", message: LABELS.noResult },
		});
	});

	it("prefers the agent's own stderr over the caller's wording", async () => {
		const { deps, context } = harness([
			terminal({
				ok: false,
				reason: "timed-out",
				stderrTail: "the real cause",
			}),
		]);
		const result = await runEngineTask(deps, context, TASK, INPUT, LABELS);
		expect(result).toEqual({
			ok: false,
			outcome: { ok: false, reason: "timed-out", message: "the real cause" },
		});
	});

	it("falls back to the caller's wording when the agent said nothing", async () => {
		const { deps, context } = harness([
			terminal({ ok: false, reason: "crashed", stderrTail: "" }),
		]);
		const result = await runEngineTask(deps, context, TASK, INPUT, LABELS);
		expect(result).toEqual({
			ok: false,
			outcome: { ok: false, reason: "crashed", message: LABELS.failed },
		});
	});

	it("reports a tool call as activity and a plan as an itinerary", async () => {
		const { deps, context, reported } = harness([
			{ type: "tool", name: "Read", target: "src/a.ts" },
			{ type: "plan", steps: [{ label: "look", state: "pending" }] },
			terminal(),
		]);
		await runEngineTask(deps, context, TASK, INPUT, LABELS);
		expect(reported.map((entry) => entry.update.kind)).toEqual([
			"activity",
			"itinerary",
		]);
		expect(reported.every((entry) => entry.runId === "run-1")).toBe(true);
	});

	it("stops the engine when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const { deps, context, engine } = harness([terminal()], controller.signal);
		await runEngineTask(deps, context, TASK, INPUT, LABELS);
		expect(engine.stopped).toBe(true);
	});

	it("stops the engine when the signal aborts mid-run", async () => {
		const controller = new AbortController();
		const { deps, context, engine } = harness([terminal()], controller.signal);
		const running = runEngineTask(deps, context, TASK, INPUT, LABELS);
		controller.abort();
		await running;
		expect(engine.stopped).toBe(true);
	});

	it("leaves no abort listener behind once it has answered", async () => {
		const controller = new AbortController();
		const { deps, context, engine } = harness([terminal()], controller.signal);
		await runEngineTask(deps, context, TASK, INPUT, LABELS);
		controller.abort();
		expect(engine.stopped).toBe(false);
	});
});
