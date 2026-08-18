import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../src/application/ports/RunManager";
import { ClaudeEngine } from "../src/infrastructure/engine/ClaudeEngine";
import { buildTestContainer } from "./helpers/buildTestContainer";
import { createPathShim, type PathShim } from "./helpers/shimPath";

/**
 * The one end-to-end analysis path in this milestone that uses the real
 * adapter: a recorded comprehension stream, replayed by the fake `claude` on a
 * stripped PATH, all the way through to annotations on disk. Everything between
 * the child process and `.prreview/` is production code (PAT-003, REQ-009).
 */

const FIXTURE = fileURLToPath(
	new URL("./fixtures/claude/understanding.jsonl", import.meta.url),
);

const GREETING_OLD_OID = "1".repeat(40);
const GREETING_NEW_OID = "2".repeat(40);
const MAIN_OLD_OID = "3".repeat(40);
const MAIN_NEW_OID = "4".repeat(40);

const GREETING_NEW = [
	"export function greet(name: string, excited = false) {",
	'  const base = "hello, " + name;',
	'  return excited ? base + "!" : base;',
	"}",
].join("\n");

const MAIN_NEW = [
	'import { greet } from "./greeting";',
	"",
	"export function run() {",
	'  console.log(greet("world", true));',
	"}",
].join("\n");

/** the same two files the fixture's anchors name, with the same line numbers */
const DIFF = `diff --git a/src/greeting.ts b/src/greeting.ts
index ${GREETING_OLD_OID}..${GREETING_NEW_OID} 100644
--- a/src/greeting.ts
+++ b/src/greeting.ts
@@ -1,3 +1,4 @@
-export function greet(name: string) {
-  return "hello, " + name;
+export function greet(name: string, excited = false) {
+  const base = "hello, " + name;
+  return excited ? base + "!" : base;
 }
diff --git a/src/main.ts b/src/main.ts
index ${MAIN_OLD_OID}..${MAIN_NEW_OID} 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,5 +1,5 @@
 import { greet } from "./greeting";

 export function run() {
-  console.log(greet("world"));
+  console.log(greet("world", true));
 }
`;

let shim: PathShim;
let originalPath: string | undefined;
let workspaceDir: string;

beforeAll(async () => {
	originalPath = process.env.PATH;
	shim = await createPathShim();
	// the engine spawns with this as cwd, so it has to exist
	workspaceDir = await mkdtemp(join(tmpdir(), "prreview-analysis-"));
});

afterAll(async () => {
	process.env.PATH = originalPath;
	await Promise.all([
		shim.dispose(),
		rm(workspaceDir, { recursive: true, force: true }),
	]);
});

afterEach(() => {
	process.env.PATH = originalPath;
	delete process.env.FAKE_CLAUDE_FIXTURE;
});

function containerOverFakeClaude() {
	process.env.PATH = shim.withFakes;
	process.env.FAKE_CLAUDE_FIXTURE = FIXTURE;
	return buildTestContainer({
		agent: { kind: "claude", version: "2.1.233" },
		engine: new ClaudeEngine(),
		github: null,
		repoRoot: workspaceDir,
		git: {
			refs: { HEAD: "a".repeat(40) },
			worktreeDiff: DIFF,
			objectContents: {
				[GREETING_NEW_OID]: GREETING_NEW,
				[MAIN_NEW_OID]: MAIN_NEW,
			},
		},
	});
}

async function settled(
	setup: ReturnType<typeof buildTestContainer>,
	runId: string,
): Promise<Run> {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		const run = setup.container.runManager.get(runId);
		if (
			run !== undefined &&
			run.status !== "queued" &&
			run.status !== "running"
		) {
			return run;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`run ${runId} never settled`);
}

describe("analysis over the real claude adapter", () => {
	it("turns a recorded comprehension stream into a stored understanding and run metadata", async () => {
		const setup = containerOverFakeClaude();
		const review = await setup.container.openReview({ target: "working" });

		const enqueued = await setup.container.runAnalysis({
			manifest: review.manifest,
			roundId: review.roundId,
			ref: review.ref,
			files: review.files,
			ticket: null,
		});
		if (enqueued.kind !== "accepted") {
			throw new Error(`expected an accepted run, got ${enqueued.kind}`);
		}
		const run = await settled(setup, enqueued.runId);

		expect(run.status).toBe("succeeded");
		expect(run.skippedAnchors).toBe(0);

		const analysis = await setup.store.loadRoundAnalysis(
			review.manifest.changesetId,
			review.roundId,
		);
		expect(analysis?.understanding.headline).toContain("excited");
		// a list of lines, never one paragraph: the field's shape is what stops
		// the overview coming back as a wall of text
		expect(analysis?.understanding.summary.length).toBeGreaterThan(0);
		expect(analysis?.understanding.topics.length).toBeGreaterThan(0);
		expect(analysis?.understanding.topics[0]?.id).toBe("t1");
		// no ticket was discovered for a worktree review, so the verdict can only
		// be about internal coherence — and the server, not the agent, says so
		expect(analysis?.understanding.goalMatch.basis).toBe("inferred");
		// the read log records what the agent actually looked at (CON-007)
		expect(analysis?.readLog.reads.length).toBeGreaterThan(0);

		// the comprehension pass writes nothing to the diff margin: narration
		// belongs beside its code on the Understanding tab, and the margin is
		// reserved for findings
		expect(
			await setup.store.loadAnnotations(review.manifest.changesetId),
		).toEqual([]);

		const manifest = await setup.store.loadSessionManifest(
			review.manifest.changesetId,
		);
		const runs = manifest?.rounds.find(
			(round) => round.id === review.roundId,
		)?.runs;
		expect(runs).toHaveLength(1);
		expect(runs?.[0].status).toBe("succeeded");
		expect(runs?.[0].stage).toBe("comprehension");
		expect(runs?.[0].model).not.toBe("");
		expect(manifest?.engine.analysisSessionId).toBe(runs?.[0].engineSessionId);

		expect(setup.events.map((event) => event.type)).toEqual([
			"run.queued",
			"run.started",
			"understanding.updated",
			"run.succeeded",
		]);
	});
});
