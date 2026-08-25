import { describe, expect, it } from "vitest";
import { buildTestContainer } from "../../../../test/helpers/buildTestContainer";
import { stubReviewRunner } from "../../../../test/helpers/stubReviewRunner";
import { createApp } from "../app";
import { createSseHub } from "../events/sseHub";
import { createReviewState } from "../reviewState";

describe("GET /api/changeset", () => {
	it("returns the current ref, announcement, and files", async () => {
		const { container } = buildTestContainer();
		const state = createReviewState({
			ref: {
				source: { kind: "worktree" },
				baseSha: "a".repeat(40),
				headSha: null,
				resolvedAt: "2026-08-21T00:00:00.000Z",
			},
			announce: {
				resolved: "working tree changes",
				overrideHint: "override hint",
			},
			files: [],
		});
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
				baseSha: "a".repeat(40),
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
