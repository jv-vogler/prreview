import { describe, expect, it } from "vitest";
import { buildTestContainer } from "../../test/helpers/buildTestContainer";
import {
	FakeEngine,
	fakeResult,
	fakeSession,
} from "../../test/helpers/FakeEngine";
import { EngineError } from "../domain/errors/EngineError";
import { CHAT_THREAD_ID } from "./chatTurn";
import type { EngineEvent } from "./ports/Engine";
import type { Run } from "./ports/RunManager";

const OLD_OID = "1".repeat(40);
const NEW_OID = "2".repeat(40);

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

const ANSWER: EngineEvent[] = [
	fakeSession("chat-session-1"),
	{ type: "text", text: "The flag " },
	{ type: "text", text: "defaults to false." },
	fakeResult({
		sessionId: "chat-session-1",
		text: "The flag defaults to false.",
	}),
];

function harness(chatEvents: EngineEvent[] = ANSWER) {
	const engine = new FakeEngine({ chat: { events: chatEvents } });
	const setup = buildTestContainer({
		agent: { kind: "claude", version: "2.1.233" },
		engine,
		github: null,
		git: { refs: { HEAD: "a".repeat(40) }, worktreeDiff: DIFF },
	});
	return { engine, setup };
}

async function askedAbout(
	harnessed: ReturnType<typeof harness>,
	text = "why is the parameter optional?",
	context: { file?: string; hunkId?: string; annotationId?: string } = {},
) {
	const review = await harnessed.setup.container.openReview({
		target: "working",
	});
	const started = await harnessed.setup.container.chatTurn({
		manifest: review.manifest,
		roundId: review.roundId,
		ref: review.ref,
		files: review.files,
		text,
		context,
	});
	return { review, started };
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

function runIdOf(result: { kind: string } & Record<string, unknown>): string {
	if (result.kind !== "accepted") {
		throw new Error(`expected an accepted run, got ${result.kind}`);
	}
	return result.runId as string;
}

describe("chatTurn without an agent", () => {
	it("refuses with EngineError('agent-missing')", async () => {
		const setup = buildTestContainer({
			github: null,
			git: { refs: { HEAD: "a".repeat(40) }, worktreeDiff: DIFF },
		});
		const review = await setup.container.openReview({ target: "working" });

		await expect(
			setup.container.chatTurn({
				manifest: review.manifest,
				roundId: review.roundId,
				ref: review.ref,
				files: review.files,
				text: "what changed?",
				context: {},
			}),
		).rejects.toThrow(EngineError);
	});
});

describe("chatTurn", () => {
	it("streams deltas and settles into the stored message", async () => {
		const harnessed = harness();
		const { review, started } = await askedAbout(harnessed);
		await settled(harnessed.setup, runIdOf(started.run));

		expect(harnessed.setup.events.map((event) => event.type)).toEqual([
			"run.queued",
			"run.started",
			"chat.turn.started",
			"chat.turn.delta",
			"chat.turn.delta",
			"chat.turn.completed",
			"run.succeeded",
		]);
		const deltas = harnessed.setup.events.filter(
			(event) => event.type === "chat.turn.delta",
		);
		expect(deltas.every((event) => "turnId" in event)).toBe(true);
		expect(
			deltas.map((event) => ("text" in event ? event.text : "")).join(""),
		).toBe("The flag defaults to false.");

		const thread = await harnessed.setup.store.loadChatThread(
			review.manifest.changesetId,
			CHAT_THREAD_ID,
		);
		expect(thread?.messages).toEqual([
			{
				role: "user",
				text: "why is the parameter optional?",
				at: expect.any(String),
			},
			{
				role: "assistant",
				text: "The flag defaults to false.",
				at: expect.any(String),
			},
		]);
		expect(thread?.engineSessionId).toBe("chat-session-1");
	});

	it("records the question before the answer exists, so a failed turn keeps it", async () => {
		const harnessed = harness([
			fakeSession("chat-session-1"),
			{
				type: "result",
				ok: false,
				reason: "timed-out",
				terminalReason: "timeout",
				stderrTail: "",
			},
		]);
		const { review, started } = await askedAbout(
			harnessed,
			"does this break callers?",
		);
		const run = await settled(harnessed.setup, runIdOf(started.run));

		expect(run.status).toBe("failed");
		expect(run.error?.reason).toBe("timed-out");
		const failure = harnessed.setup.events.find(
			(event) => event.type === "chat.turn.failed",
		);
		expect(failure).toMatchObject({
			turnId: started.turnId,
			reason: "timed-out",
		});

		const thread = await harnessed.setup.store.loadChatThread(
			review.manifest.changesetId,
			CHAT_THREAD_ID,
		);
		expect(thread?.messages).toHaveLength(1);
		expect(thread?.messages[0]).toMatchObject({
			role: "user",
			text: "does this break callers?",
		});
	});

	it("frames the turn with what the user is looking at, and stores that context", async () => {
		const harnessed = harness();
		const review = await harnessed.setup.container.openReview({
			target: "working",
		});
		const hunkId = review.files[0].hunks[0].id;
		const started = await harnessed.setup.container.chatTurn({
			manifest: review.manifest,
			roundId: review.roundId,
			ref: review.ref,
			files: review.files,
			text: "what is this doing?",
			context: { file: "src/greeting.ts", hunkId },
		});
		await settled(harnessed.setup, runIdOf(started.run));

		const [call] = harnessed.engine.calls;
		expect(call.kind).toBe("chat");
		expect(call.prompt).toContain(
			`[viewing src/greeting.ts, hunk ${hunkId}, lines 1–4]`,
		);
		expect(call.prompt.endsWith("what is this doing?")).toBe(true);

		const thread = await harnessed.setup.store.loadChatThread(
			review.manifest.changesetId,
			CHAT_THREAD_ID,
		);
		expect(thread?.messages[0].context).toEqual({
			file: "src/greeting.ts",
			hunkId,
		});
	});

	it("carries the diff itself when there is no session to resume", async () => {
		const harnessed = harness();
		const { started } = await askedAbout(harnessed);
		await settled(harnessed.setup, runIdOf(started.run));

		const [call] = harnessed.engine.calls;
		expect(call.resume).toBeUndefined();
		expect(call.prompt).toContain("=== CHANGESET");
		expect(call.prompt).toContain("=== FILE");
	});

	it("forks the analysis session on the first turn and plain-resumes its own thread after", async () => {
		const harnessed = harness();
		const review = await harnessed.setup.container.openReview({
			target: "working",
		});
		// stage A has run: the manifest names the session chat inherits
		await harnessed.setup.store.saveSessionManifest({
			...review.manifest,
			engine: { ...review.manifest.engine, analysisSessionId: "session-A" },
		});
		const withAnalysis = await harnessed.setup.store.loadSessionManifest(
			review.manifest.changesetId,
		);
		if (withAnalysis === null) {
			throw new Error("expected a stored manifest");
		}
		const request = {
			manifest: withAnalysis,
			roundId: review.roundId,
			ref: review.ref,
			files: review.files,
			text: "why?",
			context: {},
		};

		const first = await harnessed.setup.container.chatTurn(request);
		await settled(harnessed.setup, runIdOf(first.run));
		harnessed.engine.options = { chat: { events: ANSWER } };
		const second = await harnessed.setup.container.chatTurn(request);
		await settled(harnessed.setup, runIdOf(second.run));

		expect(harnessed.engine.calls[0].resume).toEqual({
			sessionId: "session-A",
			fork: true,
		});
		// the forked session's own id, plain-resumed: the chat lane is serial, so
		// forking again would fragment the thread (CON-004)
		expect(harnessed.engine.calls[1].resume).toEqual({
			sessionId: "chat-session-1",
			fork: false,
		});
		// a resumed session already holds the diff
		expect(harnessed.engine.calls[0].prompt).not.toContain("=== CHANGESET");

		const manifest = await harnessed.setup.store.loadSessionManifest(
			review.manifest.changesetId,
		);
		expect(manifest?.engine.chatThreads).toEqual([
			{ id: CHAT_THREAD_ID, engineSessionId: "chat-session-1" },
		]);
	});

	it("queues a second question behind the first instead of rejecting it", async () => {
		const engine = new FakeEngine({
			chat: { events: ANSWER, blockBeforeResult: true },
		});
		const setup = buildTestContainer({
			agent: { kind: "claude", version: "2.1.233" },
			engine,
			github: null,
			git: { refs: { HEAD: "a".repeat(40) }, worktreeDiff: DIFF },
		});
		const review = await setup.container.openReview({ target: "working" });
		const request = {
			manifest: review.manifest,
			roundId: review.roundId,
			ref: review.ref,
			files: review.files,
			text: "first question",
			context: {},
		};

		const first = await setup.container.chatTurn(request);
		await engine.started;
		const second = await setup.container.chatTurn({
			...request,
			text: "second question",
		});

		expect(second.run.kind).toBe("accepted");
		expect(second.turnId).not.toBe(first.turnId);
		expect(setup.container.runManager.get(runIdOf(second.run))?.status).toBe(
			"queued",
		);

		engine.releaseRun();
		expect((await settled(setup, runIdOf(first.run))).status).toBe("succeeded");
		engine.releaseRun();
		expect((await settled(setup, runIdOf(second.run))).status).toBe(
			"succeeded",
		);
		expect(
			engine.calls.map((call) => call.prompt.endsWith("first question")),
		).toEqual([true, false]);
	});

	it("runs a chat turn while an analysis run is in flight", async () => {
		const engine = new FakeEngine({
			task: {
				events: [
					fakeSession("session-A"),
					fakeResult({ sessionId: "session-A" }),
				],
				blockBeforeResult: true,
			},
			chat: { events: ANSWER },
		});
		const setup = buildTestContainer({
			agent: { kind: "claude", version: "2.1.233" },
			engine,
			github: null,
			git: { refs: { HEAD: "a".repeat(40) }, worktreeDiff: DIFF },
		});
		const review = await setup.container.openReview({ target: "working" });
		const analysis = await setup.container.runAnalysis({
			manifest: review.manifest,
			roundId: review.roundId,
			ref: review.ref,
			files: review.files,
		});
		await engine.started;

		const chat = await setup.container.chatTurn({
			manifest: review.manifest,
			roundId: review.roundId,
			ref: review.ref,
			files: review.files,
			text: "what is happening?",
			context: {},
		});
		expect((await settled(setup, runIdOf(chat.run))).status).toBe("succeeded");
		// the analysis lane is still busy: two lanes, two children
		expect(setup.container.runManager.get(runIdOf(analysis))?.status).toBe(
			"running",
		);
		engine.releaseRun();
		await settled(setup, runIdOf(analysis));
	});
});
