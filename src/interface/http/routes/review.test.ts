import { describe, expect, it } from "vitest";
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
	} = {},
) {
	const { container } = buildTestContainer({
		agent:
			engine === null
				? { kind: "none" }
				: { kind: "claude", version: "2.1.239" },
		engine,
		git:
			options.statusPorcelainAfter === undefined
				? undefined
				: { statusPorcelainSequence: ["", options.statusPorcelainAfter] },
	});
	const state = createReviewState({
		ref: {
			source: { kind: "worktree" },
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
	return { app };
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
