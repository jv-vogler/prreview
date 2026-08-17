import gitDiffParser from "gitdiff-parser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildComprehensionTask } from "../src/application/analysis/comprehensionTask";
import type { EngineEvent } from "../src/application/ports/Engine";
import type { ChangesetRef } from "../src/domain/changeset/ChangesetRef";
import type { FileDiff } from "../src/domain/changeset/FileDiff";
import { parseDiff } from "../src/domain/changeset/parseDiff";
import { ClaudeEngine } from "../src/infrastructure/engine/ClaudeEngine";
import {
	createFixtureRepo,
	type FixtureRepo,
} from "./helpers/createFixtureRepo";

/**
 * The only tests in this repository that run the real `claude` CLI, and the way
 * to re-validate the adapter against a new CLI release (TEST-009).
 *
 * They cost the runner real tokens, so they are opt-in — nothing runs without
 * `PRREVIEW_REAL_CLAUDE=1`, which CI never sets. Everything about them is sized
 * to be cheap: the cheapest model, a two-file repo, a prompt of a few hundred
 * bytes, small turn budgets, and hard timeouts well under the product's own.
 *
 *   PRREVIEW_REAL_CLAUDE=1 npx vitest run test/realClaude.test.ts
 *
 * The model is pinned through `ANTHROPIC_MODEL` rather than a flag because the
 * adapter deliberately passes no `--model` (TASK-024: a run uses the user's own
 * configured default, and their own budget controls with it).
 */

const OPTED_IN = process.env.PRREVIEW_REAL_CLAUDE === "1";
const CHEAPEST_MODEL = "haiku";

/** hard ceilings for a smoke; the product's own budgets are minutes long */
const TASK_TIMEOUT_MS = 120_000;
const CHAT_TIMEOUT_MS = 60_000;
const TASK_MAX_TURNS = 8;
const CHAT_MAX_TURNS = 3;
const TEST_TIMEOUT_MS = 180_000;

const VERSION_PATTERN = /^\d+\.\d+\.\d+/;

describe.skipIf(!OPTED_IN)("the real claude CLI", () => {
	let repo: FixtureRepo;
	let files: FileDiff[];
	let previousModel: string | undefined;

	beforeAll(async () => {
		previousModel = process.env.ANTHROPIC_MODEL;
		process.env.ANTHROPIC_MODEL = CHEAPEST_MODEL;

		repo = await createFixtureRepo();
		await repo.write("src/greeting.ts", COMMITTED_GREETING);
		await repo.write("src/main.ts", COMMITTED_MAIN);
		await repo.commitAll("add the greeting");
		await repo.write("src/greeting.ts", CHANGED_GREETING);
		await repo.write("src/main.ts", CHANGED_MAIN);

		const diffText = await repo.git(["diff", "--no-color", "HEAD"]);
		files = parseDiff(gitDiffParser.parse(diffText));
		expect(files.map((file) => file.path)).toEqual([
			"src/greeting.ts",
			"src/main.ts",
		]);
	}, TEST_TIMEOUT_MS);

	afterAll(async () => {
		if (previousModel === undefined) {
			delete process.env.ANTHROPIC_MODEL;
		} else {
			process.env.ANTHROPIC_MODEL = previousModel;
		}
		await repo?.dispose();
	});

	it("reports its version through probe()", async () => {
		const agent = await new ClaudeEngine().probe();

		expect(agent.kind).toBe("claude");
		expect(agent.version).toMatch(VERSION_PATTERN);
	});

	it(
		"answers a comprehension task with structured output whose anchors resolve",
		async () => {
			const engine = new ClaudeEngine();
			const built = buildComprehensionTask({
				ref: workingRef(),
				files,
				roundId: "r1",
				workspaceDir: repo.root,
			});

			const events = await collect(
				engine.runTask(
					{
						...built.task,
						maxTurns: TASK_MAX_TURNS,
						timeoutMs: TASK_TIMEOUT_MS,
					},
					built.input,
				),
			);

			const result = terminalOf(events);
			if (!result.ok) {
				throw new Error(
					`the real CLI failed the comprehension task: ${result.reason} (${result.terminalReason ?? "no terminal reason"})\n${result.stderrTail}`,
				);
			}
			// the adapter re-validates structured output against the same zod
			// schema that produced the JSON Schema (REQ-007), so reaching here at
			// all means the model's answer matched the contract
			const comprehension = result.structuredOutput as Comprehension;
			expect(comprehension.intentMap.summary.length).toBeGreaterThan(0);
			expect(comprehension.walkthrough.steps.length).toBeGreaterThan(0);
			expect(comprehension.explanations.length).toBeGreaterThan(0);

			for (const explanation of comprehension.explanations) {
				const anchor = explanation.anchor;
				const file = files.find((candidate) => candidate.path === anchor.path);
				expect(
					file,
					`anchored on ${anchor.path}, which is not in the change`,
				).toBeDefined();
				expect(anchor.endLine).toBeGreaterThanOrEqual(anchor.startLine);
				expect(anchor.startLine).toBeLessThanOrEqual(
					lastLineOf(file as FileDiff, anchor.side),
				);
			}

			// grounding: the agent read the workspace rather than only the diff
			expect(result.readLog.reads.length).toBeGreaterThan(0);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"streams text back from a chat turn",
		async () => {
			const engine = new ClaudeEngine();

			const events = await collect(
				engine.chatTurn({
					prompt:
						"In one short sentence, what does the greet function in src/greeting.ts do?",
					workspaceDir: repo.root,
					maxTurns: CHAT_MAX_TURNS,
					timeoutMs: CHAT_TIMEOUT_MS,
				}),
			);

			const deltas = events.filter((event) => event.type === "text");
			expect(deltas.length).toBeGreaterThan(0);

			const result = terminalOf(events);
			if (!result.ok) {
				throw new Error(
					`the real CLI failed the chat turn: ${result.reason}\n${result.stderrTail}`,
				);
			}
			expect(result.text ?? "").not.toBe("");
		},
		TEST_TIMEOUT_MS,
	);
});

interface Comprehension {
	intentMap: { summary: string };
	walkthrough: { steps: unknown[] };
	explanations: ReadonlyArray<{
		anchor: {
			path: string;
			side: "old" | "new";
			startLine: number;
			endLine: number;
		};
	}>;
}

type TerminalEvent = Extract<EngineEvent, { type: "result" }>;

async function collect(
	events: AsyncIterable<EngineEvent>,
): Promise<EngineEvent[]> {
	const collected: EngineEvent[] = [];
	for await (const event of events) {
		collected.push(event);
	}
	return collected;
}

function terminalOf(events: readonly EngineEvent[]): TerminalEvent {
	const terminal = events.at(-1);
	if (terminal?.type !== "result") {
		throw new Error("the run produced no terminal result event");
	}
	return terminal;
}

/** the highest line number the diff printed for that side of the file */
function lastLineOf(file: FileDiff, side: "old" | "new"): number {
	return file.hunks.reduce((highest, hunk) => {
		const end =
			side === "old"
				? hunk.oldStart + hunk.oldLines
				: hunk.newStart + hunk.newLines;
		return Math.max(highest, end);
	}, 0);
}

function workingRef(): ChangesetRef {
	return {
		source: { kind: "worktree" },
		baseSha: "HEAD",
		headSha: null,
		resolvedAt: new Date().toISOString(),
	};
}

const COMMITTED_GREETING = [
	"export function greet(name: string) {",
	'  return "hello, " + name;',
	"}",
	"",
].join("\n");

const CHANGED_GREETING = [
	"export function greet(name: string, excited = false) {",
	'  const base = "hello, " + name;',
	'  return excited ? base + "!" : base;',
	"}",
	"",
].join("\n");

const COMMITTED_MAIN = [
	'import { greet } from "./greeting";',
	"",
	"export function run() {",
	'  console.log(greet("world"));',
	"}",
	"",
].join("\n");

const CHANGED_MAIN = [
	'import { greet } from "./greeting";',
	"",
	"export function run() {",
	'  console.log(greet("world", true));',
	"}",
	"",
].join("\n");
