import { spawn } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadDiffFixture } from "../../../test/helpers/loadDiffFixture";
import type { RoundReview } from "../../application/review/RoundReview";
import type { StoredAnnotation } from "../../domain/annotation/Annotation";
import { parseDiff } from "../../domain/changeset/parseDiff";
import { StoreError } from "../../domain/errors/StoreError";
import { SCHEMA_VERSION } from "../../domain/session/SCHEMA_VERSION";
import type { SessionManifest } from "../../domain/session/SessionManifest";
import { SessionStore } from "./SessionStore";

const TEST_DEBOUNCE_MS = 30;

const temporaryDirectories: string[] = [];

afterAll(async () => {
	await Promise.all(
		temporaryDirectories.map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

async function makeDataDir(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "prreview-store-"));
	temporaryDirectories.push(directory);
	return join(directory, ".prreview");
}

async function makeStore(): Promise<{ store: SessionStore; dataDir: string }> {
	const dataDir = await makeDataDir();
	return {
		store: new SessionStore({ dataDir, debounceMs: TEST_DEBOUNCE_MS }),
		dataDir,
	};
}

function manifest(overrides: Partial<SessionManifest> = {}): SessionManifest {
	return {
		schemaVersion: SCHEMA_VERSION,
		changesetId: "worktree",
		source: { kind: "worktree" },
		toolchain: { agent: { kind: "none" }, github: { kind: "none" } },
		rounds: [
			{
				id: "r1",
				ref: {
					source: { kind: "worktree" },
					baseSha: "a".repeat(40),
					headSha: null,
					worktreeFingerprint: "f".repeat(64),
					resolvedAt: "2026-08-15T00:00:00.000Z",
				},
				runs: [],
			},
		],
		currentRound: "r1",
		engine: { adapter: "none", chatThreads: [] },
		...overrides,
	};
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected the promise to reject");
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function exitedPid(): Promise<number> {
	const child = spawn("sh", ["-c", ":"], { stdio: "ignore" });
	const pid = child.pid as number;
	await new Promise((resolve) => child.on("close", resolve));
	return pid;
}

describe("session manifest round-trip", () => {
	it("persists through flush and reads back from a fresh store instance", async () => {
		const { store, dataDir } = await makeStore();
		const saved = manifest();
		const write = store.saveSessionManifest(saved);
		await store.flush();
		await write;

		const reopened = new SessionStore({ dataDir });
		expect(await reopened.loadSessionManifest("worktree")).toEqual(saved);
	});

	it("returns null when no session exists", async () => {
		const { store } = await makeStore();
		expect(await store.loadSessionManifest("worktree")).toBeNull();
	});

	it("keys the directory by the slugged ChangesetId (ARCHITECTURE §11)", async () => {
		const { store, dataDir } = await makeStore();
		store.saveSessionManifest(
			manifest({
				changesetId: "pr:acme/api#482",
				source: { kind: "pr", repo: "acme/api", number: 482 },
			}),
		);
		await store.flush();
		const sessions = await readdir(join(dataDir, "sessions"));
		expect(sessions).toEqual(["pr-acme-api-482"]);
	});
});

describe("debounced atomic writes", () => {
	it("holds writes for the window, then lands them without .tmp leftovers", async () => {
		const { store, dataDir } = await makeStore();
		const sessionDir = join(dataDir, "sessions", "worktree");
		store.saveCoverage("worktree", { abc: "viewed" });

		// inside the window: nothing on disk yet
		await expect(
			readFile(join(sessionDir, "coverage.json"), "utf8"),
		).rejects.toThrow();

		await sleep(TEST_DEBOUNCE_MS * 4);
		expect(await store.loadCoverage("worktree")).toEqual({ abc: "viewed" });

		const entries = await readdir(sessionDir);
		expect(entries.filter((name) => name.endsWith(".tmp"))).toEqual([]);
	});

	it("coalesces saves inside one window; the last data wins", async () => {
		const { store } = await makeStore();
		const first = store.saveCoverage("worktree", { abc: "viewed" });
		const second = store.saveCoverage("worktree", { abc: "reviewed" });
		expect(second).toBe(first);

		await store.flush();
		expect(await store.loadCoverage("worktree")).toEqual({ abc: "reviewed" });
	});

	it("flush writes immediately, without waiting out the window", async () => {
		const { store } = await makeStore();
		store.saveCoverage("worktree", { abc: "viewed" });
		await store.flush();
		expect(await store.loadCoverage("worktree")).toEqual({ abc: "viewed" });
	});
});

describe("corruption and the schema gate (CON-004 boundary #4)", () => {
	async function writeSessionFile(dataDir: string, content: string) {
		const sessionDir = join(dataDir, "sessions", "worktree");
		await mkdir(sessionDir, { recursive: true });
		await writeFile(join(sessionDir, "session.json"), content);
	}

	it("invalid JSON → StoreError('corrupt')", async () => {
		const { store, dataDir } = await makeStore();
		await writeSessionFile(dataDir, "{ not json");
		const error = await rejectionOf(store.loadSessionManifest("worktree"));
		expect(error).toBeInstanceOf(StoreError);
		expect((error as StoreError).reason).toBe("corrupt");
	});

	it("valid JSON that fails the schema → StoreError('corrupt')", async () => {
		const { store, dataDir } = await makeStore();
		await writeSessionFile(
			dataDir,
			JSON.stringify({ schemaVersion: SCHEMA_VERSION, rounds: "nope" }),
		);
		const error = await rejectionOf(store.loadSessionManifest("worktree"));
		expect(error).toBeInstanceOf(StoreError);
		expect((error as StoreError).reason).toBe("corrupt");
	});

	it("missing schemaVersion → StoreError('corrupt')", async () => {
		const { store, dataDir } = await makeStore();
		await writeSessionFile(
			dataDir,
			JSON.stringify({ changesetId: "worktree" }),
		);
		const error = await rejectionOf(store.loadSessionManifest("worktree"));
		expect(error).toBeInstanceOf(StoreError);
		expect((error as StoreError).reason).toBe("corrupt");
	});

	it("a file from a newer prreview → StoreError('schema-newer-than-binary')", async () => {
		const { store, dataDir } = await makeStore();
		await writeSessionFile(
			dataDir,
			JSON.stringify(manifest({ schemaVersion: SCHEMA_VERSION + 1 })),
		);
		const error = await rejectionOf(store.loadSessionManifest("worktree"));
		expect(error).toBeInstanceOf(StoreError);
		expect((error as StoreError).reason).toBe("schema-newer-than-binary");
	});

	it("a corrupt coverage file → StoreError('corrupt')", async () => {
		const { store, dataDir } = await makeStore();
		const sessionDir = join(dataDir, "sessions", "worktree");
		await mkdir(sessionDir, { recursive: true });
		await writeFile(
			join(sessionDir, "coverage.json"),
			JSON.stringify({ abc: "skimmed" }),
		);
		const error = await rejectionOf(store.loadCoverage("worktree"));
		expect(error).toBeInstanceOf(StoreError);
		expect((error as StoreError).reason).toBe("corrupt");
	});
});

describe("round changeset snapshots", () => {
	it("round-trips a real parsed IR under rounds/rN/changeset.json", async () => {
		const { store, dataDir } = await makeStore();
		const files = parseDiff(loadDiffFixture("modify.patch"));

		const write = store.saveRoundChangeset("worktree", "r1", files);
		await store.flush();
		await write;

		expect(await store.loadRoundChangeset("worktree", "r1")).toEqual(files);
		const stored = join(
			dataDir,
			"sessions",
			"worktree",
			"rounds",
			"r1",
			"changeset.json",
		);
		await expect(readFile(stored, "utf8")).resolves.toContain('"hunks"');
	});

	it("returns null for a round that was never written", async () => {
		const { store } = await makeStore();
		expect(await store.loadRoundChangeset("worktree", "r9")).toBeNull();
	});
});

describe("coverage", () => {
	it("defaults to an empty record when nothing was saved", async () => {
		const { store } = await makeStore();
		expect(await store.loadCoverage("worktree")).toEqual({});
	});
});

describe("annotations", () => {
	function storedAnnotation(): StoredAnnotation {
		return {
			id: "01ANNOTATION",
			species: "explanation",
			anchor: {
				fileId: "F1",
				path: "a.ts",
				side: "new",
				startLine: 3,
				endLine: 3,
				placement: "in-diff",
				snapshot: {
					blobOid: "b".repeat(40),
					targetLines: ["const b = 3;"],
					lineHash: "c".repeat(64),
					contextBefore: ["const a = 1;"],
					contextAfter: [],
				},
			},
			anchorStatus: "anchored",
			body: "the constant moved to 3 so the caller sees the new default",
			category: "mechanism",
			provenance: {
				roundId: "r1",
				stage: "comprehension",
				engineSessionId: "session-A",
			},
			createdAt: "2026-08-17T10:00:00.000Z",
		};
	}

	async function writeAnnotationsFile(dataDir: string, content: string) {
		const sessionDir = join(dataDir, "sessions", "worktree");
		await mkdir(sessionDir, { recursive: true });
		await writeFile(join(sessionDir, "annotations.json"), content);
	}

	it("round-trips stored annotations under annotations.json", async () => {
		const { store, dataDir } = await makeStore();
		const annotations = [storedAnnotation()];

		const write = store.saveAnnotations("worktree", annotations);
		await store.flush();
		await write;

		expect(await store.loadAnnotations("worktree")).toEqual(annotations);
		const stored = join(dataDir, "sessions", "worktree", "annotations.json");
		await expect(readFile(stored, "utf8")).resolves.toContain('"explanation"');
	});

	it("defaults to an empty list when nothing was saved", async () => {
		const { store } = await makeStore();
		expect(await store.loadAnnotations("worktree")).toEqual([]);
	});

	it("refuses an annotations file that does not match the schema", async () => {
		const { store, dataDir } = await makeStore();
		await writeAnnotationsFile(dataDir, '[{"id":"x"}]');

		const error = await rejectionOf(store.loadAnnotations("worktree"));
		expect(error).toBeInstanceOf(StoreError);
		expect((error as StoreError).reason).toBe("corrupt");
	});
});

describe("round analysis", () => {
	it("round-trips the comprehension output under rounds/rN/analysis.json", async () => {
		const { store, dataDir } = await makeStore();
		const analysis = {
			understanding: {
				headline: "The greeting gains a flag.",
				summary: ["Callers that pass nothing are unaffected."],
				topics: [
					{
						id: "t1",
						title: "Add the flag",
						summary: "the change",
						kind: "core" as const,
						refs: [{ path: "a.ts", hunkIds: ["F1h1"] }],
					},
				],
				suggestedEntryPoint: "a.ts",
				goalMatch: {
					verdict: "matches" as const,
					rationale: "it does",
					basis: "inferred" as const,
					ticket: null,
				},
				uncoveredHunks: [{ path: "b.ts", hunkId: "F2h1" }],
			},
			readLog: {
				reads: [{ path: "/repo/a.ts", offset: 1, limit: 40 }],
				searchHits: [],
			},
			runId: "run-1",
			engineSessionId: "session-A",
		};

		const write = store.saveRoundAnalysis("worktree", "r1", analysis);
		await store.flush();
		await write;

		expect(await store.loadRoundAnalysis("worktree", "r1")).toEqual(analysis);
		const stored = join(
			dataDir,
			"sessions",
			"worktree",
			"rounds",
			"r1",
			"analysis.json",
		);
		await expect(readFile(stored, "utf8")).resolves.toContain(
			'"uncoveredHunks"',
		);
	});

	it("returns null for a round that was never analyzed", async () => {
		const { store } = await makeStore();
		expect(await store.loadRoundAnalysis("worktree", "r1")).toBeNull();
	});

	/**
	 * `readLog.reads` used to be a list of paths and now carries the range each
	 * `Read` asked for. That is not an additive change, so a strict schema would
	 * refuse every round already on disk — and a bare path has a faithful
	 * reading, because an absent range is exactly what "the whole file was read"
	 * means downstream.
	 */
	it("reads a log an older prreview wrote as bare paths", async () => {
		const { store, dataDir } = await makeStore();
		const path = join(
			dataDir,
			"sessions",
			"worktree",
			"rounds",
			"r9",
			"analysis.json",
		);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(
			path,
			JSON.stringify({
				understanding: {
					headline: "An older round.",
					summary: ["written by a previous version"],
					topics: [],
					suggestedEntryPoint: "a.ts",
					goalMatch: {
						verdict: "unclear",
						rationale: "no ticket",
						basis: "inferred",
						ticket: null,
					},
					uncoveredHunks: [],
				},
				readLog: { reads: ["/repo/a.ts", "/repo/b.ts"], searchHits: [] },
				runId: "run-old",
				engineSessionId: "session-old",
			}),
		);

		const loaded = await store.loadRoundAnalysis("worktree", "r9");
		expect(loaded?.readLog.reads).toEqual([
			{ path: "/repo/a.ts" },
			{ path: "/repo/b.ts" },
		]);
	});
});

describe("round review", () => {
	it("round-trips the findings pass's own record under rounds/<id>/review.json", async () => {
		const { store, dataDir } = await makeStore();
		const review: RoundReview = {
			discarded: [
				{
					title: "Too unsure to raise",
					species: "finding",
					severity: "consider",
					lenses: ["design", "fresh-eyes"],
					reason: { kind: "below-confidence-floor", confidence: 62, floor: 80 },
				},
			],
			skippedAnchors: 2,
			readLog: {
				reads: [{ path: "src/a.ts", offset: 1, limit: 60 }],
				searchHits: ["src/b.ts"],
			},
			runId: "run-7",
			producedAt: "2026-08-19T10:00:00.000Z",
		};

		const write = store.saveRoundReview("worktree", "r1", review);
		await store.flush();
		await write;

		expect(await store.loadRoundReview("worktree", "r1")).toEqual(review);
		const stored = join(
			dataDir,
			"sessions",
			"worktree",
			"rounds",
			"r1",
			"review.json",
		);
		await expect(readFile(stored, "utf8")).resolves.toContain(
			'"below-confidence-floor"',
		);
	});

	it("returns null for a round that was never reviewed", async () => {
		const { store } = await makeStore();
		expect(await store.loadRoundReview("worktree", "r1")).toBeNull();
	});

	/**
	 * Derived output: reproducible by re-running the pass, and never the only
	 * copy of anything a person wrote. A moved shape costs a re-run, not the
	 * session — annotations stay strict, because curation state is the
	 * reviewer's own work.
	 */
	it("offers a fresh pass rather than refusing the session on a shape it cannot read", async () => {
		const { store, dataDir } = await makeStore();
		const path = join(
			dataDir,
			"sessions",
			"worktree",
			"rounds",
			"r2",
			"review.json",
		);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify({ discarded: "not a list" }));

		await expect(store.loadRoundReview("worktree", "r2")).resolves.toBeNull();
	});
});

describe("chat threads", () => {
	it("round-trips a thread under chat/<threadId>.json", async () => {
		const { store, dataDir } = await makeStore();
		const thread = {
			id: "t1",
			engineSessionId: "chat-session-1",
			messages: [
				{
					role: "user" as const,
					text: "why?",
					context: { file: "a.ts" },
					at: "2026-08-17T10:00:00.000Z",
				},
				{
					role: "assistant" as const,
					text: "because",
					at: "2026-08-17T10:00:01.000Z",
				},
			],
		};

		const write = store.saveChatThread("worktree", "t1", thread);
		await store.flush();
		await write;

		expect(await store.loadChatThread("worktree", "t1")).toEqual(thread);
		const stored = join(dataDir, "sessions", "worktree", "chat", "t1.json");
		await expect(readFile(stored, "utf8")).resolves.toContain('"assistant"');
	});

	it("returns null for a thread with no history", async () => {
		const { store } = await makeStore();
		expect(await store.loadChatThread("worktree", "t1")).toBeNull();
	});

	it("refuses a thread id that could escape the session directory", async () => {
		const { store } = await makeStore();
		expect(() =>
			store.saveChatThread("worktree", "../../etc/passwd", {
				id: "x",
				messages: [],
			}),
		).toThrow(/thread id/);
	});
});

describe("lock pidfile: one server per session", () => {
	it("second acquire against a live holder → StoreError('locked')", async () => {
		const { store, dataDir } = await makeStore();
		await store.acquireLock("worktree");

		const contender = new SessionStore({ dataDir });
		const error = await rejectionOf(contender.acquireLock("worktree"));
		expect(error).toBeInstanceOf(StoreError);
		expect((error as StoreError).reason).toBe("locked");
		expect((error as StoreError).message).toContain(String(process.pid));
	});

	it("release then acquire succeeds", async () => {
		const { store, dataDir } = await makeStore();
		await store.acquireLock("worktree");
		await store.releaseLock("worktree");
		await new SessionStore({ dataDir }).acquireLock("worktree");
	});

	it("breaks a stale lock whose pid is dead", async () => {
		const { store, dataDir } = await makeStore();
		const sessionDir = join(dataDir, "sessions", "worktree");
		await mkdir(sessionDir, { recursive: true });
		await writeFile(join(sessionDir, "lock"), String(await exitedPid()));

		await store.acquireLock("worktree");
		expect(await readFile(join(sessionDir, "lock"), "utf8")).toBe(
			String(process.pid),
		);
	});

	it("treats a garbage pidfile as stale", async () => {
		const { store, dataDir } = await makeStore();
		const sessionDir = join(dataDir, "sessions", "worktree");
		await mkdir(sessionDir, { recursive: true });
		await writeFile(join(sessionDir, "lock"), "not-a-pid");
		await store.acquireLock("worktree");
	});
});

describe("content-addressed blobs", () => {
	const oid = "b".repeat(40);

	it("writes under .prreview/blobs/<oid> and reads back byte-exact", async () => {
		const { store, dataDir } = await makeStore();
		const content = Buffer.from([0, 1, 2, 255, 0]);
		await store.writeBlob(oid, content);

		expect((await store.readBlob(oid))?.equals(content)).toBe(true);
		expect(await store.hasBlob(oid)).toBe(true);
		await expect(readFile(join(dataDir, "blobs", oid))).resolves.toBeDefined();
	});

	it("rewriting an existing oid is a no-op", async () => {
		const { store } = await makeStore();
		const content = Buffer.from("original");
		await store.writeBlob(oid, content);
		await store.writeBlob(oid, Buffer.from("would-be-overwrite"));
		expect((await store.readBlob(oid))?.toString()).toBe("original");
	});

	it("missing blob reads as null, hasBlob as false", async () => {
		const { store } = await makeStore();
		expect(await store.readBlob("c".repeat(40))).toBeNull();
		expect(await store.hasBlob("c".repeat(40))).toBe(false);
	});

	it("refuses a non-oid name: nothing but hex ever becomes a blob path", async () => {
		const { store } = await makeStore();
		await expect(
			store.writeBlob("../escape", Buffer.from("x")),
		).rejects.toThrow("not a blob oid");
	});
});

describe(".git/info/exclude registration (SEC-003)", () => {
	async function makeGitCommonDir(): Promise<{
		gitCommonDir: string;
		repoRoot: string;
	}> {
		const repoRoot = await mkdtemp(join(tmpdir(), "prreview-exclude-"));
		temporaryDirectories.push(repoRoot);
		const gitCommonDir = join(repoRoot, ".git");
		await mkdir(gitCommonDir, { recursive: true });
		return { gitCommonDir, repoRoot };
	}

	it("appends .prreview/ to info/exclude, creating the file when absent", async () => {
		const { store } = await makeStore();
		const { gitCommonDir } = await makeGitCommonDir();
		await store.ensureExcluded(gitCommonDir);
		expect(await readFile(join(gitCommonDir, "info", "exclude"), "utf8")).toBe(
			".prreview/\n",
		);
	});

	it("is idempotent and preserves existing entries", async () => {
		const { store } = await makeStore();
		const { gitCommonDir } = await makeGitCommonDir();
		await mkdir(join(gitCommonDir, "info"), { recursive: true });
		await writeFile(join(gitCommonDir, "info", "exclude"), "*.log");

		await store.ensureExcluded(gitCommonDir);
		await store.ensureExcluded(gitCommonDir);

		expect(await readFile(join(gitCommonDir, "info", "exclude"), "utf8")).toBe(
			"*.log\n.prreview/\n",
		);
	});

	it("never touches the user's .gitignore", async () => {
		const { store } = await makeStore();
		const { gitCommonDir, repoRoot } = await makeGitCommonDir();
		await writeFile(join(repoRoot, ".gitignore"), "node_modules/\n");

		await store.ensureExcluded(gitCommonDir);

		expect(await readFile(join(repoRoot, ".gitignore"), "utf8")).toBe(
			"node_modules/\n",
		);
	});
});
