import { describe, expect, it } from "vitest";
import { FakeEngine } from "../../../test/helpers/FakeEngine";
import { FakeGit } from "../../../test/helpers/FakeGit";
import { FakeGithubService } from "../../../test/helpers/FakeGithubService";
import { FakeSessionStore } from "../../../test/helpers/FakeSessionStore";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { buildReviewJob } from "./runReview";

const FILES: FileDiff[] = [];

const BASE_SHA = "a".repeat(40);

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

function passWith(...titles: string[]) {
	return {
		...PASS,
		findings: titles.map((title) => ({
			path: "src/a.ts",
			startLine: 1,
			endLine: 1,
			kind: "defect",
			tier: "nitpick",
			title,
			body: "x",
			proof: "Inferred: x",
			verified: false,
			lane: "review",
		})),
	};
}

/** One completed pass over the same changeset, into the same store. */
async function runPassProducing(
	pass: unknown,
	sessionStore: FakeSessionStore,
): Promise<void> {
	const engine = new FakeEngine();
	engine.events = [{ ...okResult(), structuredOutput: pass }];
	const job = buildReviewJob(
		{
			engine,
			git: new FakeGit({ statusPorcelain: "" }),
			sessionStore,
			githubService: null,
			report: () => {},
		},
		{
			changesetId: "worktree",
			announce: "reviewing",
			files: FILES,
			headSha: null,
			baseSha: BASE_SHA,
			source: { kind: "worktree" },
			full: false,
		},
	);
	expect(await job(context())).toEqual({ ok: true });
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
				baseSha: BASE_SHA,
				source: { kind: "worktree" },
				full: false,
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
				baseSha: BASE_SHA,
				source: { kind: "worktree" },
				full: false,
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
				baseSha: BASE_SHA,
				source: { kind: "pr", repo: "o/r", number: 7 },
				full: false,
			},
		);
		await job(context());

		expect(sessionStore.saved[0]?.headSha).toBe("abc123");
	});

	it("carries a previous publish record forward, with its findingIds emptied", async () => {
		const sessionStore = new FakeSessionStore();
		await sessionStore.saveReview({
			changesetId: "pr-7",
			createdAt: "2026-08-01T00:00:00.000Z",
			headSha: "old",
			pass: PASS,
			residue: [],
			findingEdits: { "finding-0": { deleted: true } },
			published: {
				reviewId: 99,
				htmlUrl: "https://example.com/r/99",
				publishedAt: "2026-08-02T00:00:00.000Z",
				findingIds: ["finding-0"],
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
				baseSha: BASE_SHA,
				source: { kind: "pr", repo: "o/r", number: 7 },
				full: false,
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
			findingIds: [],
		});
		expect(saved?.findingEdits).toEqual({});
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
						kind: "defect",
						tier: "should-fix",
						title: "Greeting drops the name",
						body: "engine wording",
						proof: "Verified: ran it",
						verified: true,
						lane: "review",
					},
					{
						path: "src/greeting.ts",
						startLine: 2,
						endLine: 2,
						kind: "question",
						title: "Why greet by first name only",
						body: "Why only the first name here?",
						proof: "Looked at the callers; none answer it.",
						verified: false,
						lane: "review",
					},
				],
			},
			residue: [],
			findingEdits: { "finding-0": { body: "reader wording" } },
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
				baseSha: BASE_SHA,
				source: { kind: "pr", repo: "o/r", number: 7 },
				full: false,
			},
		);
		await job(context());

		const prompt = engine.lastInput?.prompt ?? "";
		expect(prompt).toContain("## Previous review");
		expect(prompt).toContain("Greeting drops the name");
		expect(prompt).toContain("reader wording");
		expect(prompt).toContain("alice on src/greeting.ts:2");
		// a prior question has no tier to print, and says so where the tier goes
		expect(prompt).toContain(
			"2. [finding-1] (question) Why greet by first name only",
		);
	});

	it("re-reviews without the conversation when GitHub is unreachable", async () => {
		const sessionStore = new FakeSessionStore();
		await sessionStore.saveReview({
			changesetId: "pr-7",
			createdAt: "2026-08-20T00:00:00.000Z",
			headSha: "old",
			pass: PASS,
			residue: [],
			findingEdits: {},
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
				baseSha: BASE_SHA,
				source: { kind: "pr", repo: "o/r", number: 7 },
				full: false,
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
				baseSha: BASE_SHA,
				source: { kind: "worktree" },
				full: false,
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
				baseSha: BASE_SHA,
				source: { kind: "worktree" },
				full: false,
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
				baseSha: BASE_SHA,
				source: { kind: "worktree" },
				full: false,
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
				baseSha: BASE_SHA,
				source: { kind: "worktree" },
				full: false,
			},
		);
		controller.abort();
		await job(context(controller.signal));
		expect(engine.stopped).toBe(true);
	});

	it("names the first pass's findings exactly as their positions did", async () => {
		const sessionStore = new FakeSessionStore();
		await runPassProducing(passWith("first", "second"), sessionStore);

		expect(sessionStore.saved[0]).toMatchObject({
			findingIds: ["finding-0", "finding-1"],
			nextFindingId: 2,
		});
	});

	it("never hands a later finding a number an earlier one already had", async () => {
		const sessionStore = new FakeSessionStore();
		await runPassProducing(passWith("first", "second"), sessionStore);
		await runPassProducing(passWith("third"), sessionStore);

		expect(sessionStore.saved[1]).toMatchObject({
			findingIds: ["finding-2"],
			nextFindingId: 3,
		});
	});
});

const FILE_A: FileDiff = {
	id: "file-a",
	path: "src/a.ts",
	status: "modified",
	additions: 1,
	deletions: 0,
	isBinary: false,
	isGenerated: false,
	oldBlob: { kind: "odb", oid: "a1" },
	newBlob: { kind: "odb", oid: "a2" },
	hunks: [],
};

const FILE_B: FileDiff = {
	...FILE_A,
	id: "file-b",
	path: "src/b.ts",
	oldBlob: { kind: "odb", oid: "b1" },
	newBlob: { kind: "odb", oid: "b2" },
};

/** `src/a.ts` after one more commit; `src/b.ts` has not been touched. */
const FILE_A_MOVED: FileDiff = {
	...FILE_A,
	newBlob: { kind: "odb", oid: "a3" },
};

function findingOn(path: string, title: string, dependsOn?: string[]) {
	return {
		path,
		startLine: 1,
		endLine: 1,
		kind: "defect",
		tier: "nitpick",
		title,
		body: "x",
		proof: "Inferred: x",
		verified: false,
		lane: "review",
		...(dependsOn === undefined ? {} : { dependsOn }),
	};
}

async function runPass(options: {
	files: FileDiff[];
	output: Record<string, unknown>;
	sessionStore: FakeSessionStore;
	full?: boolean;
}): Promise<{ prompt: string }> {
	const engine = new FakeEngine();
	engine.events = [{ ...okResult(), structuredOutput: options.output }];
	const job = buildReviewJob(
		{
			engine,
			git: new FakeGit({ statusPorcelain: "" }),
			sessionStore: options.sessionStore,
			githubService: null,
			report: () => {},
			logWarning: () => {},
		},
		{
			changesetId: "worktree",
			announce: "reviewing",
			files: options.files,
			baseSha: BASE_SHA,
			headSha: null,
			source: { kind: "worktree" },
			full: options.full ?? false,
		},
	);
	expect(await job(context())).toEqual({ ok: true });
	return { prompt: engine.lastInput?.prompt ?? "" };
}

/** A first pass over both files, with one finding anchored in each. */
async function seedTwoFindings(sessionStore: FakeSessionStore): Promise<void> {
	await runPass({
		files: [FILE_A, FILE_B],
		sessionStore,
		output: {
			...PASS,
			findings: [
				findingOn("src/a.ts", "about a", []),
				findingOn("src/b.ts", "about b", []),
			],
			explanations: [
				{ path: "src/b.ts", startLine: 1, endLine: 1, says: ["b settles."] },
			],
		},
	});
}

describe("buildReviewJob over a pass with a checkpoint", () => {
	it("renders only the files that moved, and says what is carried", async () => {
		const sessionStore = new FakeSessionStore();
		await seedTwoFindings(sessionStore);

		const { prompt } = await runPass({
			files: [FILE_A_MOVED, FILE_B],
			sessionStore,
			output: { ...PASS, findings: [] },
		});

		expect(prompt).toContain("## Since the last review");
		expect(prompt).toContain("- Changed: `src/a.ts`");
		expect(prompt).toContain("- Unchanged, byte for byte: `src/b.ts`");
		expect(prompt).toContain("carried findings: finding-1");
	});

	it("keeps a carried finding's id, the reader's edit and its publish record", async () => {
		const sessionStore = new FakeSessionStore();
		await seedTwoFindings(sessionStore);
		const seeded = await sessionStore.loadReview("worktree");
		if (seeded === null) {
			throw new Error("the seeding pass saved nothing");
		}
		await sessionStore.saveReview({
			...seeded,
			findingEdits: { "finding-1": { body: "the reader's wording" } },
			published: {
				reviewId: 1,
				htmlUrl: "https://example.com/r/1",
				publishedAt: "2026-08-22T00:00:00.000Z",
				findingIds: ["finding-0", "finding-1"],
			},
		});

		await runPass({
			files: [FILE_A_MOVED, FILE_B],
			sessionStore,
			output: { ...PASS, findings: [findingOn("src/a.ts", "about a again")] },
		});

		const merged = await sessionStore.loadReview("worktree");
		expect(merged?.findingIds).toEqual(["finding-1", "finding-2"]);
		expect(merged?.pass.findings.map((entry) => entry.title)).toEqual([
			"about b",
			"about a again",
		]);
		expect(merged?.findingEdits).toEqual({
			"finding-1": { body: "the reader's wording" },
		});
		expect(merged?.published?.findingIds).toEqual(["finding-1"]);
		// the unchanged file was never in this run's diff, so its account can
		// only come from the pass that did see it
		expect(merged?.pass.explanations.map((entry) => entry.path)).toEqual([
			"src/b.ts",
		]);
	});

	it("drops a carried finding the run says is resolved", async () => {
		const sessionStore = new FakeSessionStore();
		await seedTwoFindings(sessionStore);

		await runPass({
			files: [FILE_A_MOVED, FILE_B],
			sessionStore,
			output: {
				...PASS,
				findings: [],
				carried: [
					{
						id: "finding-1",
						verdict: "resolved",
						why: "the caller now guards",
					},
				],
			},
		});

		const merged = await sessionStore.loadReview("worktree");
		expect(merged?.pass.findings).toEqual([]);
		expect(merged?.findingIds).toEqual([]);
	});

	it("marks what it carried without looking, and not what it re-checked", async () => {
		const sessionStore = new FakeSessionStore();
		await runPass({
			files: [FILE_A, FILE_B],
			sessionStore,
			output: {
				...PASS,
				findings: [
					findingOn("src/b.ts", "leans on a", ["src/a.ts"]),
					findingOn("src/b.ts", "leans on nothing that moved", []),
				],
			},
		});

		await runPass({
			files: [FILE_A_MOVED, FILE_B],
			sessionStore,
			output: {
				...PASS,
				findings: [],
				carried: [{ id: "finding-0", verdict: "stands" }],
			},
		});

		const merged = await sessionStore.loadReview("worktree");
		expect(merged?.findingIds).toEqual(["finding-0", "finding-1"]);
		expect(merged?.carriedFindingIds).toEqual(["finding-1"]);
	});

	it("reviews everything again when the reader asks for it", async () => {
		const sessionStore = new FakeSessionStore();
		await seedTwoFindings(sessionStore);

		const { prompt } = await runPass({
			files: [FILE_A_MOVED, FILE_B],
			sessionStore,
			full: true,
			output: { ...PASS, findings: [] },
		});

		expect(prompt).not.toContain("## Since the last review");
		expect(prompt).toContain("### src/b.ts");
		const replaced = await sessionStore.loadReview("worktree");
		expect(replaced?.pass.findings).toEqual([]);
		expect(replaced?.carriedFindingIds).toEqual([]);
	});

	it("ignores a verdict naming no finding in the pass, and says so", async () => {
		const sessionStore = new FakeSessionStore();
		await seedTwoFindings(sessionStore);
		const warnings: string[] = [];
		const engine = new FakeEngine();
		engine.events = [
			{
				...okResult(),
				structuredOutput: {
					...PASS,
					findings: [],
					carried: [{ id: "finding-99", verdict: "resolved" }],
				},
			},
		];
		const job = buildReviewJob(
			{
				engine,
				git: new FakeGit({ statusPorcelain: "" }),
				sessionStore,
				githubService: null,
				report: () => {},
				logWarning: (message) => warnings.push(message),
			},
			{
				changesetId: "worktree",
				announce: "reviewing",
				files: [FILE_A_MOVED, FILE_B],
				baseSha: BASE_SHA,
				headSha: null,
				source: { kind: "worktree" },
				full: false,
			},
		);

		expect(await job(context())).toEqual({ ok: true });
		expect(warnings[0]).toContain("finding-99");
		const merged = await sessionStore.loadReview("worktree");
		expect(merged?.findingIds).toEqual(["finding-1"]);
	});
});
