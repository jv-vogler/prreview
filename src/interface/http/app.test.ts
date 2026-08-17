import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	analyze,
	createAnalysisApp,
	seedFindings,
} from "../../../test/helpers/createAnalysisApp";
import {
	createTestApp,
	TEST_HEAD_SHA,
	TEST_WORKTREE_DIFF,
} from "../../../test/helpers/createTestApp";
import { changesetDtoSchema } from "./dto/ChangesetDto";
import { coverageSummaryDtoSchema } from "./dto/CoverageSummaryDto";
import { refreshResponseSchema } from "./dto/RefreshResponse";
import { sessionDtoSchema } from "./dto/SessionDto";

describe("GET /api/session", () => {
	it("serves the descriptor, toolchain, announce, and coverage summary", async () => {
		const { app } = await createTestApp();
		const response = await app.request("/api/session");

		expect(response.status).toBe(200);
		const session = sessionDtoSchema.parse(await response.json());
		expect(session.changesetId).toBe("worktree");
		expect(session.source).toEqual({ kind: "worktree" });
		expect(session.roundId).toBe("r1");
		expect(session.resumed).toBe(false);
		expect(session.announce.resolved).toContain("working tree");
		expect(session.announce.overrideHint).not.toBe("");
		expect(session.coverage.total).toBe(0);
		expect(session.analysis).toEqual({
			understandingAvailable: false,
			findingsAvailable: false,
			annotationCount: 0,
		});
	});

	it("reports what analysis has produced, so the first render can route", async () => {
		const app = await createAnalysisApp();
		await analyze(app);

		const session = sessionDtoSchema.parse(
			await (await app.app.request("/api/session")).json(),
		);
		expect(session.analysis.understandingAvailable).toBe(true);
		// the comprehension pass writes nothing to the margin
		expect(session.analysis.annotationCount).toBe(0);
		expect(session.analysis.findingsAvailable).toBe(false);

		await seedFindings(app);
		const withFindings = sessionDtoSchema.parse(
			await (await app.app.request("/api/session")).json(),
		);
		expect(withFindings.analysis.annotationCount).toBe(2);
		expect(withFindings.analysis.findingsAvailable).toBe(true);
	});

	it("carries the security headers and no-store on /api", async () => {
		const { app } = await createTestApp();
		const response = await app.request("/api/session");

		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(response.headers.get("X-Frame-Options")).toBe("DENY");
		expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
		expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe(
			"same-origin",
		);
		expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe(
			"same-origin",
		);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(response.headers.get("Content-Security-Policy")).toBe(
			"default-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; frame-ancestors 'none'",
		);
	});
});

describe("GET /api/changeset", () => {
	it("serves the current round's files and ref", async () => {
		const { app } = await createTestApp();
		const response = await app.request("/api/changeset");

		expect(response.status).toBe(200);
		const changeset = changesetDtoSchema.parse(await response.json());
		expect(changeset.roundId).toBe("r1");
		expect(changeset.files.map((file) => file.path)).toEqual([
			"src/greeting.ts",
			"notes/todo.md",
		]);
		expect(changeset.ref.baseSha).toBe(TEST_HEAD_SHA);
	});
});

describe("PUT /api/coverage", () => {
	it("upserts hunk states and answers the new summary", async () => {
		const { app, review } = await createTestApp();
		const hunkId = review.files[0].hunks[0].id;

		const response = await app.request("/api/coverage", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ updates: [{ hunkId, state: "viewed" }] }),
		});

		expect(response.status).toBe(200);
		const summary = coverageSummaryDtoSchema.parse(await response.json());
		expect(summary.total).toBe(50);

		const session = sessionDtoSchema.parse(
			await (await app.request("/api/session")).json(),
		);
		expect(session.coverage.total).toBe(50);
	});

	it("drops hunkIds the current round does not know", async () => {
		const { app } = await createTestApp();
		const response = await app.request("/api/coverage", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				updates: [{ hunkId: "not-a-real-hunk", state: "viewed" }],
			}),
		});

		expect(response.status).toBe(200);
		const summary = coverageSummaryDtoSchema.parse(await response.json());
		expect(summary.total).toBe(0);
	});

	it("rejects a body that fails the schema with 400 validation", async () => {
		const { app } = await createTestApp();
		const response = await app.request("/api/coverage", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ updates: [{ hunkId: "x", state: "unseen" }] }),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ reason: "validation" });
	});

	it("rejects malformed JSON with 400 validation", async () => {
		const { app } = await createTestApp();
		const response = await app.request("/api/coverage", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: "{not json",
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ reason: "validation" });
	});
});

describe("POST /api/changeset/refresh", () => {
	it("opens the next round and carries coverage across surviving hunks", async () => {
		const { app, review } = await createTestApp();
		const hunkId = review.files[0].hunks[0].id;
		await app.request("/api/coverage", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ updates: [{ hunkId, state: "reviewed" }] }),
		});

		const response = await app.request("/api/changeset/refresh", {
			method: "POST",
		});

		expect(response.status).toBe(200);
		const refreshed = refreshResponseSchema.parse(await response.json());
		expect(refreshed.changeset.roundId).toBe("r2");
		// same diff, same hunkIds — full carry
		expect(refreshed.coverage.total).toBe(50);

		const changeset = changesetDtoSchema.parse(
			await (await app.request("/api/changeset")).json(),
		);
		expect(changeset.roundId).toBe("r2");
	});

	it("re-anchors the round's findings and announces the carry (REQ-006)", async () => {
		const app = await createAnalysisApp();
		await analyze(app);
		await seedFindings(app);
		const before = app.events.length;

		const response = await app.app.request("/api/changeset/refresh", {
			method: "POST",
		});
		expect(response.status).toBe(200);

		// the same diff, so both notes survive and both are announced
		const announced = app.events.slice(before);
		expect(announced.map((event) => event.type)).toEqual([
			"annotation.upserted",
			"annotation.upserted",
		]);
		const annotations = (await (
			await app.app.request("/api/annotations")
		).json()) as { anchorStatus: string }[];
		expect(annotations).toHaveLength(2);
		expect(annotations.map((annotation) => annotation.anchorStatus)).toEqual([
			"anchored",
			"anchored",
		]);

		// the new round has no analysis of its own until the user asks again
		const understanding = await app.app.request("/api/understanding");
		expect(understanding.status).toBe(404);
	});
});

describe("POST /api/goodbye", () => {
	it("answers 204 and counts the tab as gone", async () => {
		const { app, lifecycle } = await createTestApp();
		const response = await app.request("/api/goodbye", { method: "POST" });

		expect(response.status).toBe(204);
		expect(lifecycle.liveness()).toBe(0);
	});
});

describe("GET /api/blob", () => {
	const GREETING_SOURCE =
		'export function greeting(): string {\n\treturn "hello";\n}\n';

	it("serves a committed blob through git show", async () => {
		const { app } = await createTestApp({
			git: {
				blobs: { [`${TEST_HEAD_SHA}:src/greeting.ts`]: GREETING_SOURCE },
			},
		});
		const response = await app.request(
			`/api/blob?ref=${TEST_HEAD_SHA}&path=${encodeURIComponent("src/greeting.ts")}`,
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			name: "src/greeting.ts",
			contents: GREETING_SOURCE,
		});
	});

	it("serves a staged blob through INDEX", async () => {
		const { app } = await createTestApp({
			git: { indexBlobs: { "src/greeting.ts": "staged contents\n" } },
		});
		const response = await app.request(
			`/api/blob?ref=INDEX&path=${encodeURIComponent("src/greeting.ts")}`,
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			name: "src/greeting.ts",
			contents: "staged contents\n",
		});
	});

	describe("WORKING against a real directory", () => {
		let repoRoot: string;

		afterEach(async () => {
			await rm(repoRoot, { recursive: true, force: true });
		});

		it("serves a worktree file inside the repo root", async () => {
			repoRoot = await mkdtemp(join(tmpdir(), "prreview-blob-"));
			await mkdir(join(repoRoot, "src"), { recursive: true });
			await writeFile(join(repoRoot, "src/greeting.ts"), GREETING_SOURCE);

			const { app } = await createTestApp({ repoRoot });
			const response = await app.request(
				`/api/blob?ref=WORKING&path=${encodeURIComponent("src/greeting.ts")}`,
			);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				name: "src/greeting.ts",
				contents: GREETING_SOURCE,
			});
		});

		it("404s a worktree file that does not exist", async () => {
			repoRoot = await mkdtemp(join(tmpdir(), "prreview-blob-"));

			const { app } = await createTestApp({ repoRoot });
			const response = await app.request(
				`/api/blob?ref=WORKING&path=${encodeURIComponent("src/greeting.ts")}`,
			);

			expect(response.status).toBe(404);
		});
	});

	it("404s a path outside the changeset's file allowlist", async () => {
		const { app } = await createTestApp({
			git: { blobs: { [`${TEST_HEAD_SHA}:package.json`]: "{}" } },
		});
		const response = await app.request(
			`/api/blob?ref=${TEST_HEAD_SHA}&path=package.json`,
		);

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ reason: "blob-not-found" });
	});

	it("404s an allowlisted path git cannot serve at that ref", async () => {
		const { app } = await createTestApp();
		const response = await app.request(
			`/api/blob?ref=${TEST_HEAD_SHA}&path=${encodeURIComponent("src/greeting.ts")}`,
		);

		expect(response.status).toBe(404);
	});
});

describe("onError (CON-003 edge #1)", () => {
	const FEATURE_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
	const MAIN_SHA = "cccccccccccccccccccccccccccccccccccccccc";

	it("maps ChangesetError('branch-not-found') to 404 with its reason", async () => {
		const branchSetup = {
			target: "feature",
			git: {
				dirty: false,
				refs: { HEAD: MAIN_SHA, feature: FEATURE_SHA, main: MAIN_SHA },
				branches: ["feature", "main"],
				diffs: { [`${MAIN_SHA}..${FEATURE_SHA}`]: TEST_WORKTREE_DIFF },
			},
		};
		const { app, git } = await createTestApp(branchSetup);

		// the branch vanishes under the session; the next refresh must 404
		delete git.state.refs?.feature;
		const response = await app.request("/api/changeset/refresh", {
			method: "POST",
		});

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({
			reason: "branch-not-found",
		});
	});

	it("turns the unexpected into 500 internal and logs it server-side", async () => {
		const { app, git, loggedErrors } = await createTestApp();

		// HEAD unresolvable is not a failure any use-case expects
		delete git.state.refs?.HEAD;
		const response = await app.request("/api/changeset/refresh", {
			method: "POST",
		});

		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({ reason: "internal" });
		expect(loggedErrors).toHaveLength(1);
	});
});

describe("unknown API paths", () => {
	it("404s without static fallback interference", async () => {
		const { app } = await createTestApp();
		const response = await app.request("/api/nope");
		expect(response.status).toBe(404);
	});
});
