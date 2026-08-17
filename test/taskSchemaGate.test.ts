import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildComprehensionTask } from "../src/application/analysis/comprehensionTask";
import { TASK_SCHEMAS } from "../src/application/analysis/taskSchemas";
import { toJsonSchema } from "../src/application/analysis/toJsonSchema";
import type { EngineEvent } from "../src/application/ports/Engine";
import { ClaudeEngine } from "../src/infrastructure/engine/ClaudeEngine";
import { createPathShim, type PathShim } from "./helpers/shimPath";

/**
 * CON-014, end to end. The outage was not that a schema was malformed in the
 * abstract — it was that the *actual production path* (a task builder's schema
 * → `argv.ts` → the CLI's own validator) failed at spawn, and no test ever put
 * those pieces in a line. This file does exactly that: it builds a real task
 * the way the analysis use-case does and runs it through the engine against a
 * fake that validates `--json-schema` the way the real CLI does.
 *
 * Reverting `toJsonSchema` to `target: "draft-2020-12"` turns every test here
 * red with the very stderr the production failure printed.
 */

const FIXTURES_DIR = fileURLToPath(
	new URL("./fixtures/claude/", import.meta.url),
);

let shim: PathShim;
let originalPath: string | undefined;
let scratchDir: string;

beforeAll(async () => {
	originalPath = process.env.PATH;
	shim = await createPathShim();
	scratchDir = await mkdtemp(join(tmpdir(), "prreview-schema-gate-"));
});

afterAll(async () => {
	process.env.PATH = originalPath;
	await Promise.all([
		shim.dispose(),
		rm(scratchDir, { recursive: true, force: true }),
	]);
});

afterEach(() => {
	process.env.PATH = originalPath;
	delete process.env.FAKE_CLAUDE_FIXTURE;
	delete process.env.FAKE_CLAUDE_LOG;
});

describe("every task schema survives the CLI's own --json-schema gate", () => {
	it("stage A's real task spec runs to a result instead of failing at spawn", async () => {
		process.env.PATH = shim.withFakes;
		process.env.FAKE_CLAUDE_FIXTURE = join(FIXTURES_DIR, "comprehension.jsonl");
		const logPath = join(scratchDir, "stage-a.jsonl");
		process.env.FAKE_CLAUDE_LOG = logPath;

		const { task, input } = buildComprehensionTask({
			ref: {
				source: { kind: "worktree" },
				baseSha: "a".repeat(40),
				headSha: null,
				resolvedAt: "2026-08-17T00:00:00.000Z",
			},
			files: [],
			roundId: "round-1",
			workspaceDir: scratchDir,
		});

		const events: EngineEvent[] = [];
		for await (const event of new ClaudeEngine().runTask(task, input)) {
			events.push(event);
		}

		const result = events.find((event) => event.type === "result");
		expect(result).toBeDefined();
		expect(result).not.toMatchObject({ reason: "crashed" });

		// and the value that reached argv is the one the gate accepted
		const invocations = (await readFile(logPath, "utf8"))
			.split("\n")
			.filter((line) => line !== "")
			.map((line) => JSON.parse(line) as { argv?: string[] });
		const argv = invocations[0]?.argv ?? [];
		const passed = argv[argv.indexOf("--json-schema") + 1] ?? "";
		expect(passed).not.toBe("");
		expect(JSON.parse(passed).$schema).toBeUndefined();
	});

	it.each(Object.entries(TASK_SCHEMAS))(
		"%s is accepted by the fake, which validates as the real CLI does",
		async (name, schema) => {
			process.env.PATH = shim.withFakes;
			process.env.FAKE_CLAUDE_FIXTURE = join(FIXTURES_DIR, "schema.jsonl");
			const logPath = join(scratchDir, `gate-${name}.jsonl`);
			process.env.FAKE_CLAUDE_LOG = logPath;

			const events: EngineEvent[] = [];
			for await (const event of new ClaudeEngine().runTask(
				{
					stage: "comprehension",
					jsonSchema: toJsonSchema(schema),
					maxTurns: 30,
					timeoutMs: 10_000,
					systemContract: "contract",
					outputSchema: schema,
				},
				{ prompt: "gate probe\n", workspaceDir: scratchDir },
			)) {
				events.push(event);
			}

			// a rejected schema means an empty stream and a non-zero exit, which
			// the adapter surfaces as a crash — the exact production symptom
			const result = events.find((event) => event.type === "result");
			expect(result).toBeDefined();
			expect(result).not.toMatchObject({ reason: "crashed" });
		},
	);
});
