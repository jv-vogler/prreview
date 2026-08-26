import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StoredReview } from "../../domain/pass/StoredReview";
import { SessionStore } from "./SessionStore";

const PASS: StoredReview["pass"] = {
	overview: "adds a greeting endpoint",
	verdict: "matches the ticket",
	ticket: "PROJ-1",
	explanations: [],
	findings: [],
};

describe("SessionStore", () => {
	let dataDir: string;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "prreview-store-"));
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	it("round-trips a saved review through a flush", async () => {
		const store = new SessionStore({ dataDir, debounceMs: 0 });
		const review: StoredReview = {
			changesetId: "pr:acme/api#42",
			createdAt: "2026-08-21T10:00:00.000Z",
			headSha: null,
			pass: PASS,
			residue: [],
			findingEdits: {},
			published: null,
		};
		await store.saveReview(review);
		await store.flush();

		const loaded = await store.loadReview("pr:acme/api#42");
		expect(loaded).toEqual(review);
	});

	it("round-trips the ids and the checkpoint a delta re-review reads back", async () => {
		const store = new SessionStore({ dataDir, debounceMs: 0 });
		const review: StoredReview = {
			changesetId: "worktree",
			createdAt: "2026-08-21T10:00:00.000Z",
			headSha: null,
			pass: PASS,
			residue: [],
			findingEdits: {},
			published: null,
			findingIds: ["finding-4"],
			nextFindingId: 5,
			carriedFindingIds: ["finding-4"],
			checkpoint: {
				baseSha: "a".repeat(40),
				headSha: null,
				files: [{ path: "src/a.ts", oldOid: "o1", newOid: null }],
			},
		};
		await store.saveReview(review);
		await store.flush();
		expect(await store.loadReview("worktree")).toEqual(review);
	});

	it("reads a review.json written when a finding was still called a comment", async () => {
		const store = new SessionStore({ dataDir, debounceMs: 0 });
		const legacy = {
			changesetId: "worktree",
			createdAt: "2026-08-21T10:00:00.000Z",
			headSha: null,
			pass: PASS,
			residue: [],
			commentEdits: { "finding-0": { body: "the reader's wording" } },
			published: {
				reviewId: 1,
				htmlUrl: "https://example.com/r/1",
				publishedAt: "2026-08-21T10:00:00.000Z",
				commentIds: ["finding-0"],
			},
		};
		await mkdir(join(dataDir, "sessions", "worktree"), { recursive: true });
		await writeFile(
			join(dataDir, "sessions", "worktree", "review.json"),
			JSON.stringify(legacy),
		);

		const loaded = await store.loadReview("worktree");

		expect(loaded?.findingEdits).toEqual({
			"finding-0": { body: "the reader's wording" },
		});
		expect(loaded?.published?.findingIds).toEqual(["finding-0"]);
	});

	it("returns null for a session that was never saved", async () => {
		const store = new SessionStore({ dataDir });
		expect(await store.loadReview("worktree")).toBeNull();
	});

	it("collapses saves inside the debounce window into one write", async () => {
		const store = new SessionStore({ dataDir, debounceMs: 50 });
		const first: StoredReview = {
			changesetId: "worktree",
			createdAt: "t1",
			headSha: null,
			pass: PASS,
			residue: [],
			findingEdits: {},
			published: null,
		};
		const second: StoredReview = { ...first, createdAt: "t2" };
		await store.saveReview(first);
		await store.saveReview(second);
		await store.flush();
		expect((await store.loadReview("worktree"))?.createdAt).toBe("t2");
	});

	it("defaults findingEdits and published for a review.json written before either existed", async () => {
		const sessionDir = join(dataDir, "sessions", "worktree");
		await mkdir(sessionDir, { recursive: true });
		await writeFile(
			join(sessionDir, "review.json"),
			JSON.stringify({
				changesetId: "worktree",
				createdAt: "2026-08-21T10:00:00.000Z",
				headSha: null,
				pass: PASS,
				residue: [],
			}),
		);
		const store = new SessionStore({ dataDir });
		const loaded = await store.loadReview("worktree");
		expect(loaded?.findingEdits).toEqual({});
		expect(loaded?.published).toBeNull();
	});

	it("still loads a pass that predates a tightened length budget", async () => {
		const sessionDir = join(dataDir, "sessions", "worktree");
		await mkdir(sessionDir, { recursive: true });

		const overview = "x".repeat(1220);
		await writeFile(
			join(sessionDir, "review.json"),
			JSON.stringify({
				changesetId: "worktree",
				createdAt: "2026-08-24T02:59:18.375Z",
				headSha: null,
				pass: { ...PASS, overview },
				residue: [],
			}),
		);
		const store = new SessionStore({ dataDir });
		const loaded = await store.loadReview("worktree");
		expect(loaded?.pass.overview).toHaveLength(1220);
	});

	it("throws StoreError('corrupt') for a file that is not valid JSON", async () => {
		const sessionDir = join(dataDir, "sessions", "worktree");
		await mkdir(sessionDir, { recursive: true });
		await writeFile(join(sessionDir, "review.json"), "not json");
		const store = new SessionStore({ dataDir });
		await expect(store.loadReview("worktree")).rejects.toMatchObject({
			reason: "corrupt",
		});
	});

	it("throws StoreError('corrupt') for a file that does not match the schema", async () => {
		const sessionDir = join(dataDir, "sessions", "worktree");
		await mkdir(sessionDir, { recursive: true });
		await writeFile(
			join(sessionDir, "review.json"),
			JSON.stringify({ not: "a review" }),
		);
		const store = new SessionStore({ dataDir });
		await expect(store.loadReview("worktree")).rejects.toMatchObject({
			reason: "corrupt",
		});
	});

	it("registers .prreview/ in info/exclude, idempotently", async () => {
		const gitCommonDir = join(dataDir, ".git");
		const store = new SessionStore({ dataDir });
		await store.ensureExcluded(gitCommonDir);
		await store.ensureExcluded(gitCommonDir);

		const contents = await readFile(
			join(gitCommonDir, "info", "exclude"),
			"utf8",
		);
		expect(contents.trim().split("\n")).toEqual([".prreview/"]);
	});
});
