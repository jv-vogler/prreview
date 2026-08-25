import { describe, expect, it } from "vitest";
import { FakeEngine } from "../../../test/helpers/FakeEngine";
import { FakeGit } from "../../../test/helpers/FakeGit";
import { FakeSessionStore } from "../../../test/helpers/FakeSessionStore";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { buildReviewJob } from "./runReview";

const FILES: FileDiff[] = [];

const PASS = {
	overview: "adds a greeting endpoint",
	verdict: "matches the ticket",
	ticket: null,
	explanations: [],
	findings: [],
};

function context(signal = new AbortController().signal) {
	return { runId: "run-1", signal };
}

describe("buildReviewJob", () => {
	it("saves the pass and reports every tool call", async () => {
		const engine = new FakeEngine();
		engine.events = [
			{ type: "tool", name: "Read", target: "src/index.ts" },
			{
				type: "result",
				ok: true,
				structuredOutput: PASS,
				text: "done",
				sessionId: "s1",
				model: "claude-sonnet-5",
				numTurns: 3,
				costUsd: 0.01,
			},
		];
		const git = new FakeGit({ statusPorcelain: "" });
		const sessionStore = new FakeSessionStore();
		const reported: unknown[] = [];

		const job = buildReviewJob(
			{
				engine,
				git,
				sessionStore,
				report: (_id, update) => reported.push(update),
			},
			{
				changesetId: "worktree",
				announce: "reviewing the working tree",
				files: FILES,
			},
		);
		const outcome = await job(context());

		expect(outcome).toEqual({ ok: true });
		expect(reported).toEqual([
			{ kind: "activity", activity: "Reading src/index.ts" },
		]);
		expect(sessionStore.saved[0]?.pass).toEqual(PASS);
	});

	it("forwards a plan event as an itinerary update", async () => {
		const engine = new FakeEngine();
		engine.events = [
			{ type: "tool", name: "Read", target: "src/a.ts" },
			{ type: "tool", name: "Read", target: "src/a.ts" },
			{ type: "tool", name: "Read", target: "src/b.ts" },
			{
				type: "plan",
				steps: [{ label: "Find the ticket", state: "done" }],
			},
			{
				type: "result",
				ok: true,
				structuredOutput: PASS,
				text: "done",
				sessionId: "s1",
				model: "m",
				numTurns: 1,
				costUsd: 0,
			},
		];
		const reported: unknown[] = [];
		const job = buildReviewJob(
			{
				engine,
				git: new FakeGit({ statusPorcelain: "" }),
				sessionStore: new FakeSessionStore(),
				report: (_id, update) => reported.push(update),
			},
			{ changesetId: "worktree", announce: "reviewing", files: FILES },
		);
		await job(context());

		expect(reported).toEqual([
			{ kind: "activity", activity: "Reading src/a.ts" },
			{ kind: "activity", activity: "Reading src/a.ts" },
			{ kind: "activity", activity: "Reading src/b.ts" },
			{
				kind: "itinerary",
				steps: [{ label: "Find the ticket", state: "done" }],
			},
		]);
	});

	it("reports the run's own residue (TASK-030)", async () => {
		const engine = new FakeEngine();
		engine.events = [
			{
				type: "result",
				ok: true,
				structuredOutput: PASS,
				text: null,
				sessionId: "s1",
				model: "m",
				numTurns: 1,
				costUsd: 0,
			},
		];
		const git = new FakeGit({
			statusPorcelainSequence: ["", "?? scratch-test.ts\n"],
		});
		const sessionStore = new FakeSessionStore();

		const job = buildReviewJob(
			{ engine, git, sessionStore, report: () => {} },
			{ changesetId: "worktree", announce: "reviewing", files: FILES },
		);
		await job(context());

		expect(sessionStore.saved[0]?.residue).toEqual(["scratch-test.ts"]);
	});

	it("fails with the engine's own reason when the run failed", async () => {
		const engine = new FakeEngine();
		engine.events = [
			{
				type: "result",
				ok: false,
				reason: "api-error",
				terminalReason: "api_error",
				stderrTail: "HTTP 429",
			},
		];
		const job = buildReviewJob(
			{
				engine,
				git: new FakeGit(),
				sessionStore: new FakeSessionStore(),
				report: () => {},
			},
			{ changesetId: "worktree", announce: "reviewing", files: FILES },
		);
		const outcome = await job(context());
		expect(outcome).toEqual({
			ok: false,
			reason: "api-error",
			message: "HTTP 429",
		});
	});

	it("fails as crashed when the stream never produced a result", async () => {
		const engine = new FakeEngine();
		engine.events = [];
		const job = buildReviewJob(
			{
				engine,
				git: new FakeGit(),
				sessionStore: new FakeSessionStore(),
				report: () => {},
			},
			{ changesetId: "worktree", announce: "reviewing", files: FILES },
		);
		const outcome = await job(context());
		expect(outcome).toMatchObject({ ok: false, reason: "crashed" });
	});

	it("stops the engine when the run is aborted", async () => {
		const engine = new FakeEngine();
		engine.events = [
			{
				type: "result",
				ok: true,
				structuredOutput: PASS,
				text: null,
				sessionId: "s1",
				model: "m",
				numTurns: 1,
				costUsd: 0,
			},
		];
		const controller = new AbortController();
		const job = buildReviewJob(
			{
				engine,
				git: new FakeGit(),
				sessionStore: new FakeSessionStore(),
				report: () => {},
			},
			{ changesetId: "worktree", announce: "reviewing", files: FILES },
		);
		controller.abort();
		await job(context(controller.signal));
		expect(engine.stopped).toBe(true);
	});
});
