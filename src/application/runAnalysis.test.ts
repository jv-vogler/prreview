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
import type { UnderstandingOut } from "./analysis/understandingSchemas";

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

const UNDERSTANDING: UnderstandingOut = {
	summary: "greet() gains an optional excited flag",
	topics: [
		{
			title: "Add an excited greeting mode",
			summary:
				"greet() takes an optional flag and appends an exclamation mark when it is set; existing callers are unaffected.",
			kind: "core",
			refs: [{ path: "src/greeting.ts", hunkIds: [] }],
		},
	],
	suggestedEntryPoint: "src/greeting.ts",
	goalMatch: {
		verdict: "matches",
		rationale: "the signature change and the body change serve one purpose",
	},
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
		ticket: null,
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
	fakeResult({ structuredOutput: UNDERSTANDING, sessionId: "session-A" }),
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
				ticket: null,
			}),
		).rejects.toThrow(EngineError);
		expect(setup.container.engine).toBeNull();
		expect(setup.container.runManager.list()).toEqual([]);
	});
});

describe("runAnalysis on a successful comprehension run", () => {
	it("persists what the pass understood, plus the run metadata", async () => {
		const harnessed = harness(SUCCESSFUL_RUN);
		const { setup } = harnessed;
		const review = await opened(harnessed);

		const enqueued = await setup.container.runAnalysis(review);
		const run = await settled(setup, runIdOf(enqueued));

		expect(run.status).toBe("succeeded");

		const analysis = await setup.store.loadRoundAnalysis(
			review.manifest.changesetId,
			review.roundId,
		);
		expect(analysis?.understanding.summary).toBe(
			"greet() gains an optional excited flag",
		);
		expect(analysis?.understanding.topics).toHaveLength(1);
		expect(analysis?.understanding.topics[0]?.id).toBe("t1");
		expect(analysis?.engineSessionId).toBe("session-A");
		expect(analysis?.runId).toBe(run.id);
	});

	/**
	 * The margin belongs to findings — things you might say to the author.
	 * Explanations are narration attached to a topic and render on the
	 * Understanding tab, beside the code they describe.
	 */
	it("produces no annotations: comprehension never writes to the diff margin", async () => {
		const harnessed = harness(SUCCESSFUL_RUN);
		const review = await opened(harnessed);

		const enqueued = await harnessed.setup.container.runAnalysis(review);
		await settled(harnessed.setup, runIdOf(enqueued));

		expect(
			await harnessed.setup.store.loadAnnotations(review.manifest.changesetId),
		).toEqual([]);
		expect(
			harnessed.setup.events.filter((event) =>
				event.type.startsWith("annotation."),
			),
		).toEqual([]);
	});

	it("announces the artifact so open clients can refetch it", async () => {
		const harnessed = harness(SUCCESSFUL_RUN);
		const review = await opened(harnessed);

		const enqueued = await harnessed.setup.container.runAnalysis(review);
		await settled(harnessed.setup, runIdOf(enqueued));

		expect(
			harnessed.setup.events.filter(
				(event) => event.type === "understanding.updated",
			),
		).toEqual([{ type: "understanding.updated", roundId: review.roundId }]);
	});

	/**
	 * `basis` is a program property, not a claim the agent gets to make: it is
	 * stamped from whether prreview actually discovered a ticket.
	 */
	it("stamps the goal-match basis from discovery, not from the agent", async () => {
		const withoutTicket = harness(SUCCESSFUL_RUN);
		const reviewA = await opened(withoutTicket);
		await settled(
			withoutTicket.setup,
			runIdOf(await withoutTicket.setup.container.runAnalysis(reviewA)),
		);
		const inferred = await withoutTicket.setup.store.loadRoundAnalysis(
			reviewA.manifest.changesetId,
			reviewA.roundId,
		);
		expect(inferred?.understanding.goalMatch.basis).toBe("inferred");
		expect(inferred?.understanding.goalMatch.ticket).toBeNull();

		const withTicket = harness(SUCCESSFUL_RUN);
		const reviewB = {
			...(await opened(withTicket)),
			ticket: { key: "ENG-7", source: "branch" as const },
		};
		await settled(
			withTicket.setup,
			runIdOf(await withTicket.setup.container.runAnalysis(reviewB)),
		);
		const grounded = await withTicket.setup.store.loadRoundAnalysis(
			reviewB.manifest.changesetId,
			reviewB.roundId,
		);
		expect(grounded?.understanding.goalMatch.basis).toBe("ticket");
		expect(grounded?.understanding.goalMatch.ticket?.key).toBe("ENG-7");
	});

	it("reports the hunks no topic accounted for", async () => {
		const harnessed = harness([
			fakeSession("session-A"),
			fakeResult({
				sessionId: "session-A",
				structuredOutput: { ...UNDERSTANDING, topics: [] },
			}),
		]);
		const review = await opened(harnessed);
		await settled(
			harnessed.setup,
			runIdOf(await harnessed.setup.container.runAnalysis(review)),
		);

		const analysis = await harnessed.setup.store.loadRoundAnalysis(
			review.manifest.changesetId,
			review.roundId,
		);
		expect(analysis?.understanding.uncoveredHunks.length).toBeGreaterThan(0);
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
			ticket: null,
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
			ticket: null,
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
