import { describe, expect, it } from "vitest";
import type { TestContainerSetup } from "../../../../test/helpers/buildTestContainer";
import { buildTestContainer } from "../../../../test/helpers/buildTestContainer";
import { FakeEngine } from "../../../../test/helpers/FakeEngine";
import type { FileDiff } from "../../../domain/changeset/FileDiff";
import { createApp } from "../app";
import { createAppEventPublisher } from "../events/appEventPublisher";
import { createSseHub } from "../events/sseHub";
import { createReviewRunner } from "../reviewRunner";
import type { CurrentChangeset } from "../reviewState";
import { createReviewState } from "../reviewState";

function testApp(
	engine: FakeEngine | null,
	options: {
		statusPorcelainAfter?: string;
		files?: CurrentChangeset["files"];
		source?: CurrentChangeset["ref"]["source"];
		github?: TestContainerSetup["github"];
	} = {},
) {
	const { container, githubService } = buildTestContainer({
		agent:
			engine === null
				? { kind: "none" }
				: { kind: "claude", version: "2.1.239" },
		engine,
		git:
			options.statusPorcelainAfter === undefined
				? undefined
				: { statusPorcelainSequence: ["", options.statusPorcelainAfter] },
		github: options.github,
	});
	const state = createReviewState({
		ref: {
			source: options.source ?? { kind: "worktree" },
			baseSha: "a".repeat(40),
			headSha: null,
			resolvedAt: "2026-08-21T00:00:00.000Z",
		},
		announce: { resolved: "working tree changes", overrideHint: "x" },
		files: options.files ?? [],
	});
	const hub = createSseHub();
	const runner = createReviewRunner(
		container,
		state,
		createAppEventPublisher(hub),
	);
	const app = createApp({
		container,
		state,
		runner,
		hub,
		repoRoot: "/repo",
		clientDir: null,
	});
	return { app, container, githubService };
}

describe("POST /api/review", () => {
	it("answers 503 agent-missing when no agent is on PATH (REQ-009)", async () => {
		const { app } = testApp(null);
		const response = await app.request("/api/review", { method: "POST" });
		expect(response.status).toBe(503);
		const body = (await response.json()) as { reason: string };
		expect(body.reason).toBe("agent-missing");
	});

	it("accepts a run and answers 202 with a runId", async () => {
		const engine = new FakeEngine();
		engine.events = [
			{
				type: "result",
				ok: true,
				structuredOutput: {
					overview: "x",
					verdict: "x",
					ticket: null,
					qualityPoints: [],
					findings: [],
				},
				text: null,
				sessionId: "s1",
				model: "m",
				numTurns: 1,
				costUsd: 0,
			},
		];
		const { app } = testApp(engine);
		const response = await app.request("/api/review", { method: "POST" });
		expect(response.status).toBe(202);
		expect(await response.json()).toHaveProperty("runId");
	});

	it("answers 409 when a review is already running", async () => {
		let resolveRun!: () => void;
		const engine = new FakeEngine();
		engine.runTask = async function* () {
			await new Promise<void>((resolve) => {
				resolveRun = resolve;
			});
		};
		const { app } = testApp(engine);
		const first = await app.request("/api/review", { method: "POST" });
		expect(first.status).toBe(202);

		const second = await app.request("/api/review", { method: "POST" });
		expect(second.status).toBe(409);
		const body = (await second.json()) as { reason: string };
		expect(body.reason).toBe("run-already-running");
		resolveRun();
	});
});

describe("GET /api/review", () => {
	it("answers null when nothing has run yet", async () => {
		const { app } = testApp(new FakeEngine());
		const response = await app.request("/api/review");
		expect(await response.json()).toEqual({ run: null, pass: null });
	});

	it("surfaces residue left behind by a successful run (SEC-003/TASK-030)", async () => {
		const engine = new FakeEngine();
		engine.events = [
			{
				type: "result",
				ok: true,
				structuredOutput: {
					overview: "x",
					verdict: "x",
					ticket: null,
					qualityPoints: [],
					findings: [],
				},
				text: null,
				sessionId: "s1",
				model: "m",
				numTurns: 1,
				costUsd: 0,
			},
		];
		const { app } = testApp(engine, {
			statusPorcelainAfter: "?? scratch-test.ts\n",
		});
		await app.request("/api/review", { method: "POST" });
		await new Promise((resolve) => setTimeout(resolve, 10));

		const response = await app.request("/api/review");
		const body = (await response.json()) as { pass?: { residue: string[] } };
		expect(body.pass?.residue).toEqual(["scratch-test.ts"]);
	});

	it("places each finding against the diff on screen (TASK-041)", async () => {
		const file: FileDiff = {
			id: "file-1",
			path: "src/greeting.ts",
			status: "modified",
			additions: 1,
			deletions: 0,
			isBinary: false,
			isGenerated: false,
			oldBlob: null,
			newBlob: null,
			hunks: [
				{
					id: "hunk-1",
					header: "",
					oldStart: 1,
					oldLines: 0,
					newStart: 1,
					newLines: 1,
					lines: [{ type: "add", content: "greeting", newLine: 1 }],
				},
			],
		};
		const engine = new FakeEngine();
		engine.events = [
			{
				type: "result",
				ok: true,
				structuredOutput: {
					overview: "x",
					verdict: "x",
					ticket: null,
					qualityPoints: [],
					findings: [
						{
							path: "src/greeting.ts",
							startLine: 1,
							endLine: 1,
							tier: "nitpick",
							title: "x",
							body: "x",
							proof: "Inferred: x",
							verified: false,
							lane: "review",
						},
						{
							path: "src/missing.ts",
							startLine: 1,
							endLine: 1,
							tier: "nitpick",
							title: "x",
							body: "x",
							proof: "Inferred: x",
							verified: false,
							lane: "review",
						},
					],
				},
				text: null,
				sessionId: "s1",
				model: "m",
				numTurns: 1,
				costUsd: 0,
			},
		];
		const { app } = testApp(engine, { files: [file] });
		await app.request("/api/review", { method: "POST" });
		await new Promise((resolve) => setTimeout(resolve, 10));

		const response = await app.request("/api/review");
		const body = (await response.json()) as {
			pass: { comments: { path: string; placement: { kind: string } }[] };
		};
		expect(body.pass.comments).toEqual([
			expect.objectContaining({
				path: "src/greeting.ts",
				placement: { kind: "exact", fileId: "file-1", side: "new", line: 1 },
			}),
			expect.objectContaining({
				path: "src/missing.ts",
				placement: { kind: "unplaceable" },
			}),
		]);
	});
});

describe("DELETE /api/review/run", () => {
	it("answers 404 when there is nothing to cancel", async () => {
		const { app } = testApp(new FakeEngine());
		const response = await app.request("/api/review/run", { method: "DELETE" });
		expect(response.status).toBe(404);
	});
});

/** Seeds one finding by running a review pass to completion (a fresh FakeEngine). */
async function appWithOneFinding(
	options: {
		source?: CurrentChangeset["ref"]["source"];
		github?: TestContainerSetup["github"];
		files?: CurrentChangeset["files"];
		findings?: Record<string, unknown>[];
	} = {},
) {
	const engine = new FakeEngine();
	engine.events = [
		{
			type: "result",
			ok: true,
			structuredOutput: {
				overview: "x",
				verdict: "x",
				ticket: null,
				qualityPoints: [],
				findings: options.findings ?? [
					{
						path: "src/greeting.ts",
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
			text: null,
			sessionId: "s1",
			model: "m",
			numTurns: 1,
			costUsd: 0,
		},
	];
	const { app, container, githubService } = testApp(engine, {
		source: options.source,
		github: options.github,
		files: options.files,
	});
	await app.request("/api/review", { method: "POST" });
	await new Promise((resolve) => setTimeout(resolve, 10));
	return { app, container, githubService };
}

describe("PATCH /api/review/comments/:id (TASK-046, TASK-047)", () => {
	it("overwrites the body and answers the recomputed pass", async () => {
		const { app } = await appWithOneFinding();
		const response = await app.request("/api/review/comments/finding-0", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ body: "reworded body" }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			comments: { id: string; body: string; edited: boolean }[];
		};
		expect(body.comments).toEqual([
			expect.objectContaining({
				id: "finding-0",
				body: "reworded body",
				edited: true,
			}),
		]);
	});

	it("answers 404 for a comment id that does not exist", async () => {
		const { app } = await appWithOneFinding();
		const response = await app.request("/api/review/comments/finding-9", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ body: "x" }),
		});
		expect(response.status).toBe(404);
	});

	it("answers 404 when no review has ever run", async () => {
		const { app } = testApp(new FakeEngine());
		const response = await app.request("/api/review/comments/finding-0", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ body: "x" }),
		});
		expect(response.status).toBe(404);
	});
});

describe("DELETE /api/review/comments/:id and .../restore (TASK-046, TASK-047)", () => {
	it("marks a comment deleted rather than removing it, then restore clears that", async () => {
		const { app } = await appWithOneFinding();
		const deleted = await app.request("/api/review/comments/finding-0", {
			method: "DELETE",
		});
		expect(deleted.status).toBe(200);
		const deletedBody = (await deleted.json()) as {
			comments: { id: string; deleted: boolean }[];
		};
		expect(deletedBody.comments).toEqual([
			expect.objectContaining({ id: "finding-0", deleted: true }),
		]);

		const restored = await app.request(
			"/api/review/comments/finding-0/restore",
			{ method: "POST" },
		);
		expect(restored.status).toBe(200);
		const body = (await restored.json()) as {
			comments: { id: string; deleted: boolean }[];
		};
		expect(body.comments).toEqual([
			expect.objectContaining({ id: "finding-0", deleted: false }),
		]);
	});
});

describe("POST /api/review/comments/:id/rework (TASK-048)", () => {
	it("starts a run and answers 202 with a runId", async () => {
		const { app } = await appWithOneFinding();
		const response = await app.request(
			"/api/review/comments/finding-0/rework",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ instruction: "concise" }),
			},
		);
		expect(response.status).toBe(202);
		expect(await response.json()).toHaveProperty("runId");
	});

	it("answers 503 agent-missing when no agent is on PATH", async () => {
		const { app } = testApp(null);
		const response = await app.request(
			"/api/review/comments/finding-0/rework",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ instruction: "concise" }),
			},
		);
		expect(response.status).toBe(503);
	});
});

const PR_SOURCE: CurrentChangeset["ref"]["source"] = {
	kind: "pr",
	repo: "acme/api",
	number: 42,
};

const GREETING_FILE: FileDiff = {
	id: "file-1",
	path: "src/greeting.ts",
	status: "modified",
	additions: 1,
	deletions: 0,
	isBinary: false,
	isGenerated: false,
	oldBlob: null,
	newBlob: null,
	hunks: [
		{
			id: "hunk-1",
			header: "",
			oldStart: 1,
			oldLines: 0,
			newStart: 1,
			newLines: 1,
			lines: [{ type: "add", content: "greeting", newLine: 1 }],
		},
	],
};

describe("POST /api/review/publish (TASK-050, TASK-053)", () => {
	it("publishes the review-lane comments and answers the recomputed pass", async () => {
		const { app, githubService } = await appWithOneFinding({
			source: PR_SOURCE,
			files: [GREETING_FILE],
		});
		const response = await app.request("/api/review/publish", {
			method: "POST",
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			published: { reviewId: number; commentIds: string[] } | null;
		};
		expect(body.published).toEqual(
			expect.objectContaining({ reviewId: 1, commentIds: ["finding-0"] }),
		);
		expect(githubService?.createdReviews).toHaveLength(1);
	});

	it("answers 400 not-a-pull-request for a non-PR changeset", async () => {
		const { app } = await appWithOneFinding();
		const response = await app.request("/api/review/publish", {
			method: "POST",
		});
		expect(response.status).toBe(400);
		const body = (await response.json()) as { reason: string };
		expect(body.reason).toBe("not-a-pull-request");
	});

	it("answers 503 no-github with no GitHub backend on PATH", async () => {
		const { app } = await appWithOneFinding({
			source: PR_SOURCE,
			github: null,
		});
		const response = await app.request("/api/review/publish", {
			method: "POST",
		});
		expect(response.status).toBe(503);
		const body = (await response.json()) as { reason: string };
		expect(body.reason).toBe("no-github");
	});

	it("answers 400 nothing-publishable when every finding is pre-existing", async () => {
		const { app } = await appWithOneFinding({
			source: PR_SOURCE,
			findings: [
				{
					path: "src/greeting.ts",
					startLine: 1,
					endLine: 1,
					tier: "nitpick",
					title: "t",
					body: "x",
					proof: "Inferred: x",
					verified: false,
					lane: "pre-existing",
				},
			],
		});
		const response = await app.request("/api/review/publish", {
			method: "POST",
		});
		expect(response.status).toBe(400);
		const body = (await response.json()) as { reason: string };
		expect(body.reason).toBe("nothing-publishable");
	});

	it("answers 404 no-review when no pass has run yet", async () => {
		const { app } = testApp(new FakeEngine(), { source: PR_SOURCE });
		const response = await app.request("/api/review/publish", {
			method: "POST",
		});
		expect(response.status).toBe(404);
		const body = (await response.json()) as { reason: string };
		expect(body.reason).toBe("no-review");
	});
});
