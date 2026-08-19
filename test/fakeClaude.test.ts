import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPathShim, type PathShim } from "./helpers/shimPath";

const FIXTURES_DIR = fileURLToPath(
	new URL("./fixtures/claude/", import.meta.url),
);
const DIGESTS_PATH = join(FIXTURES_DIR, "digests.json");

const STREAM_ARGV = ["-p", "--output-format", "stream-json", "--verbose"];
const MISSING_FIXTURE_EXIT_CODE = 2;

/**
 * TEST-001: every fixture replays through test/bin/claude to a normalized
 * digest asserted against a checked-in expectation, so a fake regression and
 * a real CLI format change (after refreshing captures) both turn a test red.
 * Regenerate with: UPDATE_GOLDEN=1 npx vitest run test/fakeClaude.test.ts
 */
const FIXTURE_NAMES = [
	"simple",
	"schema",
	"tooluse",
	"badmodel",
	"understanding",
	"review",
	"chat-stream",
	"hooknoise",
	"maxturns",
	"crash",
] as const;

interface ToolUseDigest {
	name: string;
	inputKeys: string[];
}

interface ResultDigest {
	subtype: string;
	isError: boolean;
	terminalReason: string | null;
	hasResultText: boolean;
	structuredOutputPresent: boolean;
	hasSessionId: boolean;
	hasCost: boolean;
	hasUsage: boolean;
	numTurnsIsNumber: boolean;
}

interface StreamDigest {
	eventTypes: string[];
	sessionIdConsistent: boolean;
	initSeen: boolean;
	toolUses: ToolUseDigest[];
	toolResultsSeen: number;
	result: ResultDigest | null;
	exitCode: number | null;
}

let shim: PathShim;
let scratchDir: string;

beforeAll(async () => {
	shim = await createPathShim();
	scratchDir = await mkdtemp(join(tmpdir(), "prreview-fake-claude-"));
});

afterAll(async () => {
	await shim.dispose();
	await rm(scratchDir, { recursive: true, force: true });
});

describe("fake claude on the stripped PATH", () => {
	it("answers --version under withFakes (TASK-002)", async () => {
		const run = await runClaude(["--version"], {});
		expect(run.exitCode).toBe(0);
		expect(run.stdout).toBe("2.1.233 (Claude Code)\n");
	});

	it("honors FAKE_CLAUDE_VERSION", async () => {
		const run = await runClaude(["--version"], {
			FAKE_CLAUDE_VERSION: "9.9.9 (Claude Code)",
		});
		expect(run.stdout).toBe("9.9.9 (Claude Code)\n");
	});

	it("fails forced by FAKE_CLAUDE_EXIT with its stderr marker", async () => {
		const run = await runClaude(["-p"], { FAKE_CLAUDE_EXIT: "3" });
		expect(run.exitCode).toBe(3);
		expect(run.stderr).toContain("fake claude: forced failure");
	});

	it("reproduces the real CLI's --verbose contract (CON-001)", async () => {
		const run = await runClaude(["-p", "--output-format", "stream-json"], {
			FAKE_CLAUDE_FIXTURE: join(FIXTURES_DIR, "simple.jsonl"),
		});
		expect(run.exitCode).toBe(1);
		expect(run.stderr).toContain(
			"Error: When using --print, --output-format=stream-json requires --verbose",
		);
		expect(run.stdout).toBe("");
	});

	/**
	 * CON-014. These are the tests that would have caught the outage: the fake
	 * now validates `--json-schema` with the same Ajv 8 draft-07 the real CLI
	 * uses, so a schema the CLI would reject fails here too — at argv time,
	 * before a fixture is ever consulted, with nothing on stdout.
	 */
	describe("--json-schema validation (CON-014)", () => {
		const validSchema = JSON.stringify({
			type: "object",
			properties: { summary: { type: "string" } },
			required: ["summary"],
			additionalProperties: false,
		});

		it("replays normally when the schema is a valid draft-07 schema", async () => {
			const run = await runClaude(
				[...STREAM_ARGV, "--json-schema", validSchema],
				{
					FAKE_CLAUDE_FIXTURE: join(FIXTURES_DIR, "schema.jsonl"),
					stdin: "replay",
				},
			);
			expect(run.exitCode).toBe(0);
			expect(run.stdout).not.toBe("");
		});

		it("rejects a draft-2020-12 $schema the way the real CLI did", async () => {
			const run = await runClaude(
				[
					...STREAM_ARGV,
					"--json-schema",
					JSON.stringify({
						$schema: "https://json-schema.org/draft/2020-12/schema",
						type: "object",
					}),
				],
				{
					FAKE_CLAUDE_FIXTURE: join(FIXTURES_DIR, "schema.jsonl"),
					stdin: "replay",
				},
			);
			expect(run.exitCode).toBe(1);
			expect(run.stdout).toBe("");
			expect(run.stderr).toContain("--json-schema is not a valid JSON Schema");
			expect(run.stderr).toContain("2020-12");
		});

		it("rejects a value that is not JSON at all", async () => {
			const run = await runClaude([...STREAM_ARGV, "--json-schema", "{oops"], {
				FAKE_CLAUDE_FIXTURE: join(FIXTURES_DIR, "schema.jsonl"),
				stdin: "replay",
			});
			expect(run.exitCode).toBe(1);
			expect(run.stdout).toBe("");
			expect(run.stderr).toContain("--json-schema is not valid JSON");
		});

		it("rejects a structurally invalid schema", async () => {
			const run = await runClaude(
				[...STREAM_ARGV, "--json-schema", JSON.stringify({ type: "objekt" })],
				{
					FAKE_CLAUDE_FIXTURE: join(FIXTURES_DIR, "schema.jsonl"),
					stdin: "replay",
				},
			);
			expect(run.exitCode).toBe(1);
			expect(run.stdout).toBe("");
			expect(run.stderr).toContain("--json-schema is not a valid JSON Schema");
		});

		it("rejects before the fixture is consulted, so argv wins over replay", async () => {
			const run = await runClaude(
				[
					...STREAM_ARGV,
					"--json-schema",
					JSON.stringify({
						$schema: "https://json-schema.org/draft/2020-12/schema",
					}),
				],
				{ FAKE_CLAUDE_FIXTURE: join(FIXTURES_DIR, "does-not-exist.jsonl") },
			);
			expect(run.exitCode).toBe(1);
			expect(run.stderr).not.toContain("no fixture for this invocation");
		});
	});

	it("exits 2 when no fixture is configured or the file is missing", async () => {
		const unconfigured = await runClaude(STREAM_ARGV, {});
		expect(unconfigured.exitCode).toBe(MISSING_FIXTURE_EXIT_CODE);

		const missingFile = await runClaude(STREAM_ARGV, {
			FAKE_CLAUDE_FIXTURE: join(FIXTURES_DIR, "does-not-exist.jsonl"),
		});
		expect(missingFile.exitCode).toBe(MISSING_FIXTURE_EXIT_CODE);
		expect(missingFile.stderr).toContain("no fixture for this invocation");
	});

	it("logs one JSON line per invocation with the stdin fingerprint", async () => {
		const logPath = join(scratchDir, "invocations.log");
		const prompt = "what does this change do?";
		await runClaude(STREAM_ARGV, {
			FAKE_CLAUDE_FIXTURE: join(FIXTURES_DIR, "simple.jsonl"),
			FAKE_CLAUDE_LOG: logPath,
			stdin: prompt,
		});
		const lines = (await readFile(logPath, "utf8")).trim().split("\n");
		expect(lines).toHaveLength(1);
		const record = JSON.parse(lines[0] as string) as {
			argv: string[];
			cwd: string;
			stdinBytes: number;
			stdinSha256: string;
		};
		expect(record.argv).toEqual(STREAM_ARGV);
		expect(record.stdinBytes).toBe(Buffer.byteLength(prompt));
		expect(record.stdinSha256).toMatch(/^[0-9a-f]{64}$/);
	});

	it("routes by prompt substring via FAKE_CLAUDE_FIXTURE_BY_TASK", async () => {
		const byTask = JSON.stringify({
			comprehension: join(FIXTURES_DIR, "schema.jsonl"),
			"chat question": join(FIXTURES_DIR, "simple.jsonl"),
		});
		const analysisRun = await runClaude(STREAM_ARGV, {
			FAKE_CLAUDE_FIXTURE_BY_TASK: byTask,
			stdin: "run the comprehension pass over this diff",
		});
		const chatRun = await runClaude(STREAM_ARGV, {
			FAKE_CLAUDE_FIXTURE_BY_TASK: byTask,
			stdin: "a chat question about hunk h1",
		});
		expect(
			digestStream(analysisRun.stdout, analysisRun.exitCode).result
				?.structuredOutputPresent,
		).toBe(true);
		expect(
			digestStream(chatRun.stdout, chatRun.exitCode).result
				?.structuredOutputPresent,
		).toBe(false);
	});
});

describe("fixture fidelity digests (TEST-001)", () => {
	it("every fixture on disk is in the digest matrix", async () => {
		const { readdir } = await import("node:fs/promises");
		const onDisk = (await readdir(FIXTURES_DIR))
			.filter((name) => name.endsWith(".jsonl"))
			.map((name) => name.replace(/\.jsonl$/, ""))
			.sort();
		expect(onDisk).toEqual([...FIXTURE_NAMES].sort());
	});

	it("replays every fixture to its checked-in digest", async () => {
		const digests: Record<string, StreamDigest> = {};
		for (const fixtureName of FIXTURE_NAMES) {
			const run = await runClaude(STREAM_ARGV, {
				FAKE_CLAUDE_FIXTURE: join(FIXTURES_DIR, `${fixtureName}.jsonl`),
				stdin: "replay",
			});
			digests[fixtureName] = digestStream(run.stdout, run.exitCode);
		}

		if (process.env.UPDATE_GOLDEN === "1") {
			await writeFile(DIGESTS_PATH, `${JSON.stringify(digests, null, "\t")}\n`);
			return;
		}
		const expected = JSON.parse(await readFile(DIGESTS_PATH, "utf8"));
		expect(digests).toEqual(expected);
	});
});

/**
 * The fields the engine adapter will rely on, extracted the way the adapter
 * will (CON-002's whitelist: only system:init survives of the system events;
 * rate_limit_event and unknown noise are skipped, never fatal).
 */
function digestStream(stdout: string, exitCode: number | null): StreamDigest {
	const digest: StreamDigest = {
		eventTypes: [],
		sessionIdConsistent: false,
		initSeen: false,
		toolUses: [],
		toolResultsSeen: 0,
		result: null,
		exitCode,
	};
	const sessionIds = new Set<string>();

	for (const line of stdout.split("\n")) {
		if (line.trim() === "") {
			continue;
		}
		const event = JSON.parse(line);
		if (typeof event.session_id === "string") {
			sessionIds.add(event.session_id);
		}
		if (event.type === "system" && event.subtype !== "init") {
			continue;
		}
		if (event.type === "rate_limit_event") {
			continue;
		}
		digest.eventTypes.push(
			event.subtype === undefined
				? event.type
				: `${event.type}:${event.subtype}`,
		);
		if (event.type === "system" && event.subtype === "init") {
			digest.initSeen = true;
		}
		if (event.type === "assistant") {
			for (const block of event.message.content) {
				if (block.type === "tool_use") {
					digest.toolUses.push({
						name: block.name,
						inputKeys: Object.keys(block.input).sort(),
					});
				}
			}
		}
		if (event.type === "user") {
			for (const block of event.message.content ?? []) {
				if (block.type === "tool_result") {
					digest.toolResultsSeen++;
				}
			}
		}
		if (event.type === "result") {
			digest.result = {
				subtype: event.subtype,
				isError: event.is_error,
				terminalReason: event.terminal_reason ?? null,
				hasResultText: typeof event.result === "string",
				structuredOutputPresent:
					event.structured_output !== null &&
					event.structured_output !== undefined,
				hasSessionId: typeof event.session_id === "string",
				hasCost: typeof event.total_cost_usd === "number",
				hasUsage: typeof event.usage === "object" && event.usage !== null,
				numTurnsIsNumber: typeof event.num_turns === "number",
			};
		}
	}

	digest.sessionIdConsistent = sessionIds.size === 1;
	return digest;
}

interface ClaudeRun {
	stdout: string;
	stderr: string;
	exitCode: number | null;
}

/** spawns `claude` resolved through the stripped PATH, never by absolute path */
function runClaude(
	argv: string[],
	options: { stdin?: string } & Record<string, string | undefined>,
): Promise<ClaudeRun> {
	const { stdin, ...extraEnv } = options;
	return new Promise((resolve, reject) => {
		const child = spawn("claude", argv, {
			env: { PATH: shim.withFakes, ...cleanEnv(extraEnv) },
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ stdout, stderr, exitCode: code }));
		child.stdin.end(stdin ?? "");
	});
}

function cleanEnv(
	env: Record<string, string | undefined>,
): Record<string, string> {
	const defined: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) {
			defined[key] = value;
		}
	}
	return defined;
}
