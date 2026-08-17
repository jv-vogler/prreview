import { expect } from "vitest";
import type { UnderstandingOut } from "../../src/application/analysis/understandingSchemas";
import { materializeAnnotations } from "../../src/application/materializeAnnotations";
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
 * The server harness: the test app plus an agent that answers. The engine is
 * scripted after the review is open, because a believable understanding has to
 * name the round's real hunkIds — coverage and topic sizing both resolve
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
				fakeResult({ structuredOutput: understandingFor(app.review.files) }),
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

/**
 * Two topics over the two-file worktree diff, with the second topic
 * deliberately re-using the first file's hunks so every consumer is exercised
 * against the many-to-many case rather than a tidy partition.
 */
export function understandingFor(files: readonly FileDiff[]): UnderstandingOut {
	const [greeting, todo] = files;
	if (greeting === undefined || todo === undefined) {
		throw new Error("the harness expects the two-file worktree diff");
	}
	return {
		summary: "the greeting now names the reviewer, and a todo list appears",
		topics: [
			{
				title: "Greet the reviewer by name",
				summary: "The returned string now addresses whoever is reviewing.",
				kind: "core",
				refs: [{ path: greeting.path, hunkIds: hunkIdsOf(greeting) }],
			},
			{
				title: "Record what is left undone",
				summary: "A scratch list ships alongside the change.",
				kind: "docs",
				refs: [
					{ path: todo.path, hunkIds: hunkIdsOf(todo) },
					// the overlap: this hunk belongs to both topics on purpose
					{ path: greeting.path, hunkIds: hunkIdsOf(greeting) },
				],
			},
		],
		suggestedEntryPoint: greeting.path,
		goalMatch: {
			verdict: "matches",
			rationale: "the copy change and the note are consistent with one another",
		},
	};
}

/**
 * Seeds anchored findings on the current round without going through an agent.
 *
 * The comprehension pass deliberately produces no annotations — narration lives
 * on the Understanding tab, and the diff margin is reserved for findings. Tests
 * about *anchoring* still need annotations to exist, and how they were born is
 * irrelevant to whether they survive the tree moving, so they are written
 * directly here rather than through a scripted run that could fail for
 * unrelated reasons.
 */
export async function seedFindings(app: AnalysisApp): Promise<void> {
	const [greeting, todo] = app.review.files;
	if (greeting === undefined || todo === undefined) {
		throw new Error("the harness expects the two-file worktree diff");
	}
	const { annotations } = await materializeAnnotations(
		{ git: app.container.git, store: app.container.store },
		{
			drafts: [
				{
					anchor: {
						path: greeting.path,
						side: "new",
						startLine: 2,
						endLine: 2,
					},
					body: "the message is addressed to whoever is reviewing",
					species: "finding",
					category: "correctness",
				},
				{
					anchor: { path: todo.path, side: "new", startLine: 1, endLine: 1 },
					body: "the list ships with the change",
					species: "finding",
					category: "design",
				},
			],
			files: app.review.files,
			provenance: {
				roundId: app.review.roundId,
				stage: "findings",
				engineSessionId: "session-seed",
			},
			createdAt: "2026-08-17T10:00:00.000Z",
		},
	);
	await app.container.store.saveAnnotations(
		app.review.manifest.changesetId,
		annotations,
	);
	app.state.applyAnnotations(null);
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
