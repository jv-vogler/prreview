import { describe, expect, it } from "vitest";
import { buildTestContainer } from "../../../../test/helpers/buildTestContainer";
import { FakeEngine } from "../../../../test/helpers/FakeEngine";
import { stubReviewRunner } from "../../../../test/helpers/stubReviewRunner";
import { createApp } from "../app";
import { createAppEventPublisher } from "../events/appEventPublisher";
import { createSseHub } from "../events/sseHub";
import { createReviewRunner } from "../reviewRunner";
import type { CurrentChangeset } from "../reviewState";
import { createReviewState } from "../reviewState";

const BASE_SHA = "a".repeat(40);
const REVIEWED_SHA = "b".repeat(40);
const PUSHED_SHA = "c".repeat(40);

function changesetAt(headSha: string | null): CurrentChangeset {
	return {
		ref: {
			source: { kind: "pr", repo: "o/r", number: 7 },
			baseSha: BASE_SHA,
			headSha,
			resolvedAt: "2026-08-21T00:00:00.000Z",
		},
		announce: { resolved: "pull request #7", overrideHint: "override hint" },
		files: [],
	};
}

describe("GET /api/changeset", () => {
	it("returns the current ref, announcement, and files", async () => {
		const { container } = buildTestContainer();
		const current: CurrentChangeset = {
			ref: {
				source: { kind: "worktree" },
				baseSha: BASE_SHA,
				headSha: null,
				resolvedAt: "2026-08-21T00:00:00.000Z",
			},
			announce: {
				resolved: "working tree changes",
				overrideHint: "override hint",
			},
			files: [],
		};
		const state = createReviewState(current, async () => current);
		const app = createApp({
			container,
			state,
			runner: stubReviewRunner(),
			hub: createSseHub(),
			repoRoot: "/repo",
			clientDir: null,
		});
		const response = await app.request("/api/changeset");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			ref: {
				source: { kind: "worktree" },
				baseSha: BASE_SHA,
				headSha: null,
				resolvedAt: "2026-08-21T00:00:00.000Z",
			},
			announce: {
				resolved: "working tree changes",
			},
			files: [],
		});
	});
});

/**
 * A real runner over a fake engine, with a resolver the test moves: the
 * point of refresh is that the second resolution answers something the first
 * did not, which a frozen snapshot cannot express.
 */
function refreshableApp() {
	const engine = new FakeEngine();
	engine.events = [
		{
			type: "result",
			ok: true,
			structuredOutput: {
				overview: "x",
				verdict: "x",
				ticket: null,
				explanations: [],
				findings: [],
			},
			text: null,
			sessionId: "s1",
			model: "m",
			numTurns: 1,
			costUsd: 0,
		},
	];
	const { container } = buildTestContainer({
		agent: { kind: "claude", version: "2.1.239" },
		engine,
		git: { commitCounts: { [`${REVIEWED_SHA}..${PUSHED_SHA}`]: 2 } },
	});
	let resolved = changesetAt(REVIEWED_SHA);
	let failure: Error | null = null;
	const state = createReviewState(resolved, async () => {
		if (failure !== null) {
			throw failure;
		}
		return resolved;
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
	return {
		app,
		state,
		moveTo(next: CurrentChangeset) {
			resolved = next;
		},
		failWith(error: Error) {
			failure = error;
		},
	};
}

describe("POST /api/changeset/refresh", () => {
	it("answers the re-resolved changeset alongside the review status", async () => {
		const { app } = refreshableApp();
		const response = await app.request("/api/changeset/refresh", {
			method: "POST",
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			changeset: { ref: { headSha: string } };
			review: { run: unknown; pass: unknown; freshness: unknown };
		};
		expect(body.changeset.ref.headSha).toBe(REVIEWED_SHA);
		expect(body.review).toEqual({ run: null, pass: null, freshness: null });
	});

	it("reports the freshness of the head that refresh just found", async () => {
		const { app, moveTo } = refreshableApp();
		await app.request("/api/review", { method: "POST" });
		await new Promise((resolve) => setTimeout(resolve, 20));

		const beforeThePush = await app.request("/api/changeset/refresh", {
			method: "POST",
		});
		expect(
			((await beforeThePush.json()) as { review: { freshness: unknown } })
				.review.freshness,
		).toEqual({
			kind: "same-commit",
		});

		moveTo(changesetAt(PUSHED_SHA));
		const afterThePush = await app.request("/api/changeset/refresh", {
			method: "POST",
		});
		const body = (await afterThePush.json()) as {
			changeset: { ref: { headSha: string } };
			review: { freshness: unknown };
		};
		expect(body.changeset.ref.headSha).toBe(PUSHED_SHA);
		expect(body.review.freshness).toEqual({ kind: "new-commits", count: 2 });
	});

	it("keeps the last good changeset when the target can no longer be resolved", async () => {
		const { app, state, failWith } = refreshableApp();
		failWith(new Error("branch is gone"));

		const response = await app.request("/api/changeset/refresh", {
			method: "POST",
		});
		expect(response.status).toBe(500);
		expect(state.current().ref.headSha).toBe(REVIEWED_SHA);
		const served = await app.request("/api/changeset");
		expect(served.status).toBe(200);
	});
});
