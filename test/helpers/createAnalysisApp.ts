import { expect } from "vitest";
import type { ComprehensionOut } from "../../src/application/analysis/schemas";
import type { FileDiff } from "../../src/domain/changeset/FileDiff";
import {
	createTestApp,
	type TestApp,
	type TestAppSetup,
} from "./createTestApp";
import { FakeEngine, fakeResult, fakeSession } from "./FakeEngine";

/** the new-side blob oids TEST_WORKTREE_DIFF names, and their content */
const GREETING_NEW_OID = "2".repeat(40);
const TODO_NEW_OID = "3".repeat(40);

const GREETING_NEW = [
	"export function greeting(): string {",
	'\treturn "hello, reviewer";',
	"}",
].join("\n");

const TODO_NEW = ["- review the diff", "- ship it"].join("\n");

const CHAT_SESSION_ID = "chat-session-1";
export const CHAT_REPLY = "The greeting now names the reviewer.";

const RUN_SETTLE_TIMEOUT_MS = 2_000;
const POLL_STEP_MS = 5;

export interface AnalysisApp extends TestApp {
	engine: FakeEngine;
}

/**
 * The M2 server harness: the M1 test app plus an agent that answers. The engine
 * is scripted after the review is open, because a believable comprehension
 * result has to name the round's real hunkIds — the walkthrough marks coverage
 * through them, so made-up ids would prove nothing.
 */
export async function createAnalysisApp(
	setup: TestAppSetup = {},
): Promise<AnalysisApp> {
	const engine = new FakeEngine();
	const app = await createTestApp({
		agent: { kind: "claude", version: "2.1.233" },
		engine,
		...setup,
		git: {
			objectContents: {
				[GREETING_NEW_OID]: GREETING_NEW,
				[TODO_NEW_OID]: TODO_NEW,
			},
			...setup.git,
		},
	});

	engine.options = {
		task: {
			events: [
				fakeSession(),
				fakeResult({ structuredOutput: comprehensionFor(app.review.files) }),
			],
		},
		chat: {
			events: [
				fakeSession(CHAT_SESSION_ID),
				{ type: "text", text: "The greeting " },
				{ type: "text", text: "now names the reviewer." },
				fakeResult({ text: CHAT_REPLY, sessionId: CHAT_SESSION_ID }),
			],
		},
	};

	return { ...app, engine };
}

/** two explanations, two walkthrough steps, one cluster per file */
export function comprehensionFor(files: readonly FileDiff[]): ComprehensionOut {
	const [greeting, todo] = files;
	if (greeting === undefined || todo === undefined) {
		throw new Error("the harness expects the two-file worktree diff");
	}
	return {
		intentMap: {
			summary: "the greeting now names the reviewer, and a todo list appears",
			clusters: [
				{
					name: "Greeting copy",
					kind: "core",
					description: "the returned string gains the reviewer",
					members: [{ path: greeting.path, hunkIds: hunkIdsOf(greeting) }],
				},
				{
					name: "Notes",
					kind: "docs",
					description: "a scratch list of what is left",
					members: [{ path: todo.path }],
				},
			],
			suggestedEntryPoint: greeting.path,
		},
		walkthrough: {
			steps: [
				{
					title: "Start with the greeting",
					narration: "one string changes, and every caller keeps working",
					focus: [{ path: greeting.path, hunkIds: hunkIdsOf(greeting) }],
				},
				{
					title: "Then the notes",
					narration: "the todo list records what the change leaves undone",
					focus: [{ path: todo.path, hunkIds: hunkIdsOf(todo) }],
				},
			],
		},
		explanations: [
			{
				anchor: { path: greeting.path, side: "new", startLine: 2, endLine: 2 },
				kind: "intent",
				body: "the message is addressed to whoever is reviewing",
			},
			{
				anchor: { path: todo.path, side: "new", startLine: 1, endLine: 1 },
				kind: "mechanism",
				body: "the list is plain markdown and ships with the change",
			},
		],
		risk: { hunkRisks: [] },
	};
}

export function hunkIdsOf(file: FileDiff): string[] {
	return file.hunks.map((hunk) => hunk.id);
}

/** POST /api/analysis and wait for the background run to settle */
export async function analyze(app: AnalysisApp): Promise<string> {
	const response = await app.app.request("/api/analysis", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ task: "comprehension" }),
	});
	expect(response.status).toBe(202);
	const { runId } = (await response.json()) as { runId: string };
	await settle(app, runId);
	return runId;
}

/** the run manager is in-process, so "has it finished?" is a status read */
export async function settle(app: AnalysisApp, runId: string): Promise<void> {
	await waitFor(app, () => {
		const run = app.container.runManager.get(runId);
		return (
			run !== undefined && run.status !== "queued" && run.status !== "running"
		);
	});
}

export async function waitFor(
	app: AnalysisApp,
	condition: () => boolean,
): Promise<void> {
	const deadline = Date.now() + RUN_SETTLE_TIMEOUT_MS;
	while (!condition()) {
		if (Date.now() > deadline) {
			throw new Error(
				`timed out waiting; runs: ${JSON.stringify(app.container.runManager.list())}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_STEP_MS));
	}
}
