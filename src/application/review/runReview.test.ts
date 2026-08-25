import { describe, expect, it } from "vitest";
import { FakeEngine } from "../../../test/helpers/FakeEngine";
import { FakeGit } from "../../../test/helpers/FakeGit";
import { FakeGithubService } from "../../../test/helpers/FakeGithubService";
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

function okResult() {
	return {
		type: "result",
		ok: true,
		structuredOutput: PASS,
		text: "done",
		sessionId: "s1",
		model: "m",
		numTurns: 1,
		costUsd: 0,
	} as const;
}

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
				githubService: null,
				report: (_id, update) => reported.push(update),
			},
			{
				changesetId: "worktree",
				announce: "reviewing the working tree",
				files: FILES,
				headSha: null,
				source: { kind: "worktree" },
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
				githubService: null,
				report: (_id, update) => reported.push(update),
			},
			{
				changesetId: "worktree",
				announce: "reviewing",
				files: FILES,
				headSha: null,
				source: { kind: "worktree" },
			},
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

	it("records the reviewed head commit on the artifact", async () => {
		const engine = new FakeEngine();
		engine.events = [okResult()];
		const sessionStore = new FakeSessionStore();
		const job = buildReviewJob(
			{
				engine,
				git: new FakeGit({ statusPorcelain: "" }),
				sessionStore,
				githubService: null,
				report: () => {},
			},
			{
				changesetId: "pr-7",
				announce: "reviewing",
				files: FILES,
				headSha: "abc123",
				source: { kind: "pr", repo: "o/r", number: 7 },
			},
		);
		await job(context());

		expect(sessionStore.saved[0]?.headSha).toBe("abc123");
	});

	it("carries a previous publish record forward, with its commentIds emptied", async () => {
		const sessionStore = new FakeSessionStore();
		await sessionStore.saveReview({
			changesetId: "pr-7",
			createdAt: "2026-08-01T00:00:00.000Z",
			headSha: "old",
			pass: PASS,
			residue: [],
			commentEdits: { "finding-0": { deleted: true } },
			published: {
				reviewId: 99,
				htmlUrl: "https://example.com/r/99",
				publishedAt: "2026-08-02T00:00:00.000Z",
				commentIds: ["finding-0"],
			},
		});
		sessionStore.saved.length = 0;

		const engine = new FakeEngine();
		engine.events = [okResult()];
		const job = buildReviewJob(
			{
				engine,
				git: new FakeGit({ statusPorcelain: "" }),
				sessionStore,
				githubService: null,
				report: () => {},
			},
			{
				changesetId: "pr-7",
				announce: "reviewing",
				files: FILES,
				headSha: "new",
				source: { kind: "pr", repo: "o/r", number: 7 },
			},
		);
		await job(context());

		const saved = sessionStore.saved[0];
		// the pending review's id survives so the next publish replaces it,
		// but nothing in the fresh pass has been published — and the ids are
		// positional, so the old list must not bleed onto new comments
		expect(saved?.published).toEqual({
			reviewId: 99,
			htmlUrl: "https://example.com/r/99",
			publishedAt: "2026-08-02T00:00:00.000Z",
			commentIds: [],
		});
		expect(saved?.commentEdits).toEqual({});
	});

	it("feeds the previous pass and the PR conversation into the prompt on a re-review", async () => {
		const sessionStore = new FakeSessionStore();
		await sessionStore.saveReview({
			changesetId: "pr-7",
			createdAt: "2026-08-20T00:00:00.000Z",
			headSha: "old",
			pass: {
				...PASS,
				findings: [
					{
						path: "src/greeting.ts",
						startLine: 2,
						endLine: 2,
						tier: "should-fix",
						title: "Greeting drops the name",
						body: "engine wording",
						proof: "Verified: ran it",
						verified: true,
						lane: "review",
					},
				],
			},
			residue: [],
			commentEdits: { "finding-0": { body: "reader wording" } },
			published: null,
		});
		const githubService = new FakeGithubService({
			prReviewComments: {
				7: [
					{
						id: 1,
						inReplyToId: null,
						path: "src/greeting.ts",
						line: 2,
						author: "alice",
						body: "intentional, see ticket",
					},
				],
			},
		});
		const engine = new FakeEngine();
		engine.events = [okResult()];
		const job = buildReviewJob(
			{
				engine,
				git: new FakeGit({ statusPorcelain: "" }),
				sessionStore,
				githubService,
				report: () => {},
			},
			{
				changesetId: "pr-7",
				announce: "reviewing",
				files: FILES,
				headSha: "new",
				source: { kind: "pr", repo: "o/r", number: 7 },
			},
		);
		await job(context());

		const prompt = engine.lastInput?.prompt ?? "";
		expect(prompt).toContain("## Previous review");
		expect(prompt).toContain("Greeting drops the name");
		expect(prompt).toContain("reader wording");
		expect(prompt).toContain("alice on src/greeting.ts:2");
	});

	it("re-reviews without the conversation when GitHub is unreachable", async () => {
		const sessionStore = new FakeSessionStore();
		await sessionStore.saveReview({
			changesetId: "pr-7",
			createdAt: "2026-08-20T00:00:00.000Z",
			headSha: "old",
			pass: PASS,
			residue: [],
			commentEdits: {},
			published: null,
		});
		const engine = new FakeEngine();
		engine.events = [okResult()];
		const job = buildReviewJob(
			{
				engine,
				git: new FakeGit({ statusPorcelain: "" }),
				sessionStore,
				githubService: null,
				report: () => {},
			},
			{
				changesetId: "pr-7",
				announce: "reviewing",
				files: FILES,
				headSha: "new",
				source: { kind: "pr", repo: "o/r", number: 7 },
			},
		);
		const outcome = await job(context());

		expect(outcome).toEqual({ ok: true });
		const prompt = engine.lastInput?.prompt ?? "";
		expect(prompt).toContain("## Previous review");
		expect(prompt).not.toContain("### Conversation on GitHub");
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
			{ engine, git, sessionStore, githubService: null, report: () => {} },
			{
				changesetId: "worktree",
				announce: "reviewing",
				files: FILES,
				headSha: null,
				source: { kind: "worktree" },
			},
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
				githubService: null,
				report: () => {},
			},
			{
				changesetId: "worktree",
				announce: "reviewing",
				files: FILES,
				headSha: null,
				source: { kind: "worktree" },
			},
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
				githubService: null,
				report: () => {},
			},
			{
				changesetId: "worktree",
				announce: "reviewing",
				files: FILES,
				headSha: null,
				source: { kind: "worktree" },
			},
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
				githubService: null,
				report: () => {},
			},
			{
				changesetId: "worktree",
				announce: "reviewing",
				files: FILES,
				headSha: null,
				source: { kind: "worktree" },
			},
		);
		controller.abort();
		await job(context(controller.signal));
		expect(engine.stopped).toBe(true);
	});
});
