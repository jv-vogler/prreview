import { describe, expect, it } from "vitest";
import type { EngineEvent } from "../../src/application/ports/Engine";
import type { Run } from "../../src/application/ports/RunManager";
import { buildTestContainer } from "../../test/helpers/buildTestContainer";
import {
	FakeEngine,
	fakeResult,
	fakeSession,
} from "../../test/helpers/FakeEngine";
import { EngineError } from "../domain/errors/EngineError";
import type { ComprehensionOut } from "./analysis/schemas";

const OLD_OID = "1".repeat(40);
const NEW_OID = "2".repeat(40);

const GREETING_NEW = [
	"export function greet(name: string, excited = false) {",
	'  const base = "hello, " + name;',
	'  return excited ? base + "!" : base;',
	"}",
].join("\n");

const DIFF = `diff --git a/src/greeting.ts b/src/greeting.ts
index ${OLD_OID}..${NEW_OID} 100644
--- a/src/greeting.ts
+++ b/src/greeting.ts
@@ -1,3 +1,4 @@
-export function greet(name: string) {
-  return "hello, " + name;
+export function greet(name: string, excited = false) {
+  const base = "hello, " + name;
+  return excited ? base + "!" : base;
 }
`;

const COMPREHENSION: ComprehensionOut = {
	intentMap: {
		summary: "greet() gains an optional excited flag",
		clusters: [
			{
				name: "Excited greeting",
				kind: "core",
				description: "adds the flag and threads it through",
				members: [{ path: "src/greeting.ts" }],
			},
		],
		suggestedEntryPoint: "src/greeting.ts",
	},
	walkthrough: {
		steps: [
			{
				title: "The new signature",
				narration: "the optional parameter keeps old callers working",
				focus: [{ path: "src/greeting.ts", hunkIds: [] }],
			},
		],
	},
	explanations: [
		{
			anchor: {
				path: "src/greeting.ts",
				side: "new",
				startLine: 1,
				endLine: 1,
			},
			kind: "intent",
			body: "the flag defaults to false, so the change is backward compatible",
		},
	],
	risk: { hunkRisks: [] },
};

interface Harness {
	setup: ReturnType<typeof buildTestContainer>;
	engine: FakeEngine;
}

function harness(taskEvents: EngineEvent[]): Harness {
	const engine = new FakeEngine({ task: { events: taskEvents } });
	const setup = buildTestContainer({
		agent: { kind: "claude", version: "2.1.233" },
		engine,
		github: null,
		git: {
			refs: { HEAD: "a".repeat(40) },
			worktreeDiff: DIFF,
			objectContents: { [NEW_OID]: GREETING_NEW },
		},
	});
	return { setup, engine };
}

async function opened(harnessed: Harness) {
	const opened = await harnessed.setup.container.openReview({
		target: "working",
	});
	return {
		manifest: opened.manifest,
		roundId: opened.roundId,
		ref: opened.ref,
		files: opened.files,
	};
}

async function settled(
	setup: ReturnType<typeof buildTestContainer>,
	runId: string,
): Promise<Run> {
	const deadline = Date.now() + 2000;
	while (Date.now() < deadline) {
		const run = setup.container.runManager.get(runId);
		if (
			run !== undefined &&
			run.status !== "queued" &&
			run.status !== "running"
		) {
			return run;
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`run ${runId} never settled`);
}

async function waitFor(condition: () => boolean): Promise<void> {
	const deadline = Date.now() + 1000;
	while (Date.now() < deadline) {
		if (condition()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("condition never became true");
}

function runIdOf(result: { kind: string } & Record<string, unknown>): string {
	if (result.kind !== "accepted") {
		throw new Error(`expected an accepted run, got ${result.kind}`);
	}
	return result.runId as string;
}

const SUCCESSFUL_RUN: EngineEvent[] = [
	fakeSession("session-A"),
	fakeResult({ structuredOutput: COMPREHENSION, sessionId: "session-A" }),
];

describe("runAnalysis without an agent", () => {
	it("refuses with EngineError('agent-missing') and queues nothing", async () => {
		const setup = buildTestContainer({
			github: null,
			git: { refs: { HEAD: "a".repeat(40) }, worktreeDiff: DIFF },
		});
		const review = await setup.container.openReview({ target: "working" });

		await expect(
			setup.container.runAnalysis({
				manifest: review.manifest,
				roundId: review.roundId,
				ref: review.ref,
				files: review.files,
			}),
		).rejects.toThrow(EngineError);
		expect(setup.container.engine).toBeNull();
		expect(setup.container.runManager.list()).toEqual([]);
	});
});

describe("runAnalysis on a successful comprehension run", () => {
	it("persists the raw stage output, the annotations, and the run metadata", async () => {
		const harnessed = harness(SUCCESSFUL_RUN);
		const { setup } = harnessed;
		const review = await opened(harnessed);

		const enqueued = await setup.container.runAnalysis(review);
		const run = await settled(setup, runIdOf(enqueued));

		expect(run.status).toBe("succeeded");
		expect(run.skippedAnchors).toBe(0);

		const analysis = await setup.store.loadRoundAnalysis(
			review.manifest.changesetId,
			review.roundId,
		);
		expect(analysis?.comprehension.intentMap.summary).toBe(
			"greet() gains an optional excited flag",
		);
		expect(analysis?.comprehension.walkthrough.steps).toHaveLength(1);
		expect(analysis?.engineSessionId).toBe("session-A");
		expect(analysis?.runId).toBe(run.id);

		const annotations = await setup.store.loadAnnotations(
			review.manifest.changesetId,
		);
		expect(annotations).toHaveLength(1);
		expect(annotations[0].anchor.path).toBe("src/greeting.ts");
		expect(annotations[0].provenance).toEqual({
			roundId: review.roundId,
			stage: "comprehension",
			engineSessionId: "session-A",
		});

		const manifest = await setup.store.loadSessionManifest(
			review.manifest.changesetId,
		);
		expect(manifest?.engine.analysisSessionId).toBe("session-A");
		const runs = manifest?.rounds.find(
			(round) => round.id === review.roundId,
		)?.runs;
		expect(runs).toHaveLength(1);
		expect(runs?.[0]).toMatchObject({
			stage: "comprehension",
			status: "succeeded",
			engineSessionId: "session-A",
			numTurns: 3,
		});
	});

	it("publishes run events and one annotation.upserted per explanation", async () => {
		const harnessed = harness(SUCCESSFUL_RUN);
		const { setup } = harnessed;
		const review = await opened(harnessed);
		const enqueued = await setup.container.runAnalysis(review);
		await settled(setup, runIdOf(enqueued));

		expect(setup.events.map((event) => event.type)).toEqual([
			"run.queued",
			"run.started",
			"annotation.upserted",
			"run.succeeded",
		]);
	});

	it("hands the engine the reviewed-revision workspace and the numbered diff", async () => {
		const harnessed = harness(SUCCESSFUL_RUN);
		const review = await opened(harnessed);
		const enqueued = await harnessed.setup.container.runAnalysis(review);
		await settled(harnessed.setup, runIdOf(enqueued));

		const [call] = harnessed.engine.calls;
		expect(call.kind).toBe("task");
		// a worktree changeset's reviewed code IS the repo itself (§7)
		expect(call.workspaceDir).toBe("/repo");
		expect(call.prompt).toContain("=== FILE");
		expect(call.prompt).toContain("src/greeting.ts");
		// stage A always starts a fresh session
		expect(call.resume).toBeUndefined();
		expect(call.task?.stage).toBe("comprehension");
	});

	it("replaces the previous round's explanations on a re-run instead of stacking them", async () => {
		const harnessed = harness(SUCCESSFUL_RUN);
		const { setup } = harnessed;
		const review = await opened(harnessed);
		const first = await setup.container.runAnalysis(review);
		await settled(setup, runIdOf(first));
		const firstIds = (
			await setup.store.loadAnnotations(review.manifest.changesetId)
		).map((annotation) => annotation.id);

		harnessed.engine.options = { task: { events: SUCCESSFUL_RUN } };
		const second = await setup.container.runAnalysis(review);
		await settled(setup, runIdOf(second));

		const annotations = await setup.store.loadAnnotations(
			review.manifest.changesetId,
		);
		expect(annotations).toHaveLength(1);
		expect(firstIds).not.toContain(annotations[0].id);
		expect(
			setup.events.filter((event) => event.type === "annotation.removed"),
		).toEqual([{ type: "annotation.removed", id: firstIds[0] }]);
	});

	it("counts anchors it could not place as skippedAnchors on the run", async () => {
		const harnessed = harness([
			fakeSession("session-A"),
			fakeResult({
				sessionId: "session-A",
				structuredOutput: {
					...COMPREHENSION,
					explanations: [
						...COMPREHENSION.explanations,
						{
							anchor: {
								path: "src/gone.ts",
								side: "new",
								startLine: 1,
								endLine: 1,
							},
							kind: "mechanism",
							body: "about a file this changeset never touched",
						},
					],
				},
			}),
		]);
		const review = await opened(harnessed);
		const enqueued = await harnessed.setup.container.runAnalysis(review);
		const run = await settled(harnessed.setup, runIdOf(enqueued));

		expect(run.status).toBe("succeeded");
		expect(run.skippedAnchors).toBe(1);
		expect(
			await harnessed.setup.store.loadAnnotations(review.manifest.changesetId),
		).toHaveLength(1);
	});
});

describe("runAnalysis when the run fails", () => {
	it("turns unusable structured output into a schema-violation failure and applies nothing", async () => {
		const harnessed = harness([
			fakeSession("session-A"),
			fakeResult({
				sessionId: "session-A",
				structuredOutput: { intentMap: "not an object" },
			}),
		]);
		const { setup } = harnessed;
		const review = await opened(harnessed);
		const enqueued = await setup.container.runAnalysis(review);
		const run = await settled(setup, runIdOf(enqueued));

		expect(run.status).toBe("failed");
		expect(run.error?.reason).toBe("schema-violation");
		expect(
			await setup.store.loadAnnotations(review.manifest.changesetId),
		).toEqual([]);
		expect(
			await setup.store.loadRoundAnalysis(
				review.manifest.changesetId,
				review.roundId,
			),
		).toBeNull();
		const manifest = await setup.store.loadSessionManifest(
			review.manifest.changesetId,
		);
		expect(manifest?.rounds[0].runs[0]).toMatchObject({
			status: "failed",
			reason: "schema-violation",
		});
		expect(manifest?.engine.analysisSessionId).toBeUndefined();
	});

	it("carries the engine's failure reason and detail onto the run", async () => {
		const harnessed = harness([
			fakeSession("session-A"),
			{
				type: "result",
				ok: false,
				reason: "crashed",
				terminalReason: "api_error",
				stderrTail: "claude: upstream is unhappy\n",
			},
		]);
		const review = await opened(harnessed);
		const enqueued = await harnessed.setup.container.runAnalysis(review);
		const run = await settled(harnessed.setup, runIdOf(enqueued));

		expect(run.status).toBe("failed");
		expect(run.error).toEqual({
			reason: "crashed",
			message: "The analysis run failed (crashed): api_error",
		});
	});

	it("treats a stream that ends without a result as a crash", async () => {
		const harnessed = harness([fakeSession("session-A")]);
		const review = await opened(harnessed);
		const enqueued = await harnessed.setup.container.runAnalysis(review);
		const run = await settled(harnessed.setup, runIdOf(enqueued));

		expect(run.status).toBe("failed");
		expect(run.error?.reason).toBe("crashed");
		expect(run.error?.message).toContain("before it produced a result");
	});

	it("survives an engine that throws mid-stream: the run fails, the manager does not", async () => {
		const engine = new FakeEngine({
			task: {
				events: [fakeSession("session-A")],
				throwWith: new Error("the adapter exploded"),
			},
		});
		const setup = buildTestContainer({
			agent: { kind: "claude", version: "2.1.233" },
			engine,
			github: null,
			git: { refs: { HEAD: "a".repeat(40) }, worktreeDiff: DIFF },
		});
		const review = await setup.container.openReview({ target: "working" });
		const enqueued = await setup.container.runAnalysis({
			manifest: review.manifest,
			roundId: review.roundId,
			ref: review.ref,
			files: review.files,
		});
		const run = await settled(setup, runIdOf(enqueued));

		expect(run.status).toBe("failed");
		expect(run.error).toEqual({
			reason: "internal",
			message: "the adapter exploded",
		});
	});
});

describe("runAnalysis conflict and cancellation", () => {
	it("conflicts while a comprehension run is in flight, naming the run to cancel", async () => {
		const engine = new FakeEngine({
			task: { events: SUCCESSFUL_RUN, blockBeforeResult: true },
		});
		const setup = buildTestContainer({
			agent: { kind: "claude", version: "2.1.233" },
			engine,
			github: null,
			git: {
				refs: { HEAD: "a".repeat(40) },
				worktreeDiff: DIFF,
				objectContents: { [NEW_OID]: GREETING_NEW },
			},
		});
		const review = await setup.container.openReview({ target: "working" });
		const request = {
			manifest: review.manifest,
			roundId: review.roundId,
			ref: review.ref,
			files: review.files,
		};

		const first = await setup.container.runAnalysis(request);
		await engine.started;
		const second = await setup.container.runAnalysis(request);

		expect(second).toEqual({
			kind: "conflict",
			existingRunId: runIdOf(first),
		});
		engine.releaseRun();
		expect((await settled(setup, runIdOf(first))).status).toBe("succeeded");
	});

	it("cancelling a running analysis stops the engine and records the run cancelled", async () => {
		const engine = new FakeEngine({
			task: { events: SUCCESSFUL_RUN, blockBeforeResult: true },
		});
		const setup = buildTestContainer({
			agent: { kind: "claude", version: "2.1.233" },
			engine,
			github: null,
			git: { refs: { HEAD: "a".repeat(40) }, worktreeDiff: DIFF },
		});
		const review = await setup.container.openReview({ target: "working" });
		const enqueued = await setup.container.runAnalysis({
			manifest: review.manifest,
			roundId: review.roundId,
			ref: review.ref,
			files: review.files,
		});
		await engine.started;

		expect(setup.container.runManager.cancel(runIdOf(enqueued))).toBe(true);
		const run = await settled(setup, runIdOf(enqueued));

		expect(run.status).toBe("cancelled");
		// the engine's iterator was closed rather than played out: that close is
		// what sends SIGTERM in the real adapter
		engine.releaseRun();
		await waitFor(() => engine.aborted);
		expect(
			await setup.store.loadAnnotations(review.manifest.changesetId),
		).toEqual([]);
		const manifest = await setup.store.loadSessionManifest(
			review.manifest.changesetId,
		);
		expect(manifest?.rounds[0].runs[0].status).toBe("cancelled");
	});
});
