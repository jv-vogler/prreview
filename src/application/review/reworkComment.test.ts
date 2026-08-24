import { describe, expect, it } from "vitest";
import { FakeEngine } from "../../../test/helpers/FakeEngine";
import { FakeGit } from "../../../test/helpers/FakeGit";
import { FakeSessionStore } from "../../../test/helpers/FakeSessionStore";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { StoredReview } from "../ports/SessionStore";
import { buildReworkJob } from "./reworkComment";

const FILES: FileDiff[] = [];

function storedReview(overrides: Partial<StoredReview> = {}): StoredReview {
	return {
		changesetId: "worktree",
		createdAt: "2026-08-22T00:00:00.000Z",
		pass: {
			overview: "x",
			verdict: "x",
			ticket: null,
			explanations: [],
			findings: [
				{
					path: "src/a.ts",
					startLine: 1,
					endLine: 1,
					tier: "nitpick",
					title: "t",
					body: "original body",
					proof: "Inferred: x",
					verified: false,
					lane: "review",
				},
			],
		},
		residue: [],
		commentEdits: {},
		published: null,
		...overrides,
	};
}

function context(signal = new AbortController().signal) {
	return { runId: "run-1", signal };
}

describe("buildReworkJob", () => {
	it("returns the reworded body as the outcome's result", async () => {
		const engine = new FakeEngine();
		engine.events = [
			{ type: "tool", name: "Read", target: "src/a.ts" },
			{
				type: "result",
				ok: true,
				structuredOutput: { body: "shorter body" },
				text: null,
				sessionId: "s1",
				model: "m",
				numTurns: 1,
				costUsd: 0,
			},
		];
		const sessionStore = new FakeSessionStore();
		await sessionStore.saveReview(storedReview());
		const reported: unknown[] = [];

		const job = buildReworkJob(
			{
				engine,
				git: new FakeGit(),
				sessionStore,
				report: (_id, update) => reported.push(update),
			},
			{
				changesetId: "worktree",
				commentId: "finding-0",
				instruction: "concise",
				files: FILES,
			},
		);
		const outcome = await job(context());

		expect(outcome).toEqual({ ok: true, result: "shorter body" });
		expect(reported).toEqual([
			{ kind: "activity", activity: "Reading src/a.ts" },
		]);
		// never overwrites the stored pass itself — only the reader's own
		// accept, through the edit path, does that
		expect(sessionStore.saved).toHaveLength(1);
	});

	it("rejects a comment id the pass does not have", async () => {
		const sessionStore = new FakeSessionStore();
		await sessionStore.saveReview(storedReview());
		const job = buildReworkJob(
			{
				engine: new FakeEngine(),
				git: new FakeGit(),
				sessionStore,
				report: () => {},
			},
			{
				changesetId: "worktree",
				commentId: "finding-7",
				instruction: "concise",
				files: FILES,
			},
		);
		await expect(job(context())).rejects.toThrow(/does not exist/);
	});

	it("rejects reworking a comment that has been deleted", async () => {
		const sessionStore = new FakeSessionStore();
		await sessionStore.saveReview(
			storedReview({ commentEdits: { "finding-0": { deleted: true } } }),
		);
		const job = buildReworkJob(
			{
				engine: new FakeEngine(),
				git: new FakeGit(),
				sessionStore,
				report: () => {},
			},
			{
				changesetId: "worktree",
				commentId: "finding-0",
				instruction: "concise",
				files: FILES,
			},
		);
		await expect(job(context())).rejects.toThrow(/has been deleted/);
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
		const sessionStore = new FakeSessionStore();
		await sessionStore.saveReview(storedReview());
		const job = buildReworkJob(
			{ engine, git: new FakeGit(), sessionStore, report: () => {} },
			{
				changesetId: "worktree",
				commentId: "finding-0",
				instruction: "expand",
				files: FILES,
			},
		);
		const outcome = await job(context());
		expect(outcome).toEqual({
			ok: false,
			reason: "api-error",
			message: "HTTP 429",
		});
	});

	it("stops the engine when the run is aborted", async () => {
		const engine = new FakeEngine();
		engine.events = [
			{
				type: "result",
				ok: true,
				structuredOutput: { body: "x" },
				text: null,
				sessionId: "s1",
				model: "m",
				numTurns: 1,
				costUsd: 0,
			},
		];
		const sessionStore = new FakeSessionStore();
		await sessionStore.saveReview(storedReview());
		const controller = new AbortController();
		const job = buildReworkJob(
			{ engine, git: new FakeGit(), sessionStore, report: () => {} },
			{
				changesetId: "worktree",
				commentId: "finding-0",
				instruction: "explain",
				files: FILES,
			},
		);
		controller.abort();
		await job(context(controller.signal));
		expect(engine.stopped).toBe(true);
	});
});
