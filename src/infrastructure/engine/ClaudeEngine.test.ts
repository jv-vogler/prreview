import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPathShim, type PathShim } from "../../../test/helpers/shimPath";
import type {
	ChatTurnInput,
	EngineEvent,
	EngineResultEvent,
	TaskInput,
	TaskSpec,
} from "../../application/ports/Engine";
import { ClaudeEngine } from "./ClaudeEngine";

const FIXTURES_DIR = fileURLToPath(
	new URL("../../../test/fixtures/claude/", import.meta.url),
);

/** every knob these tests set is test-only and never read by src/ (REQ-002) */
const FAKE_ENV_KEYS = [
	"FAKE_CLAUDE_FIXTURE",
	"FAKE_CLAUDE_FIXTURE_BY_TASK",
	"FAKE_CLAUDE_LOG",
	"FAKE_CLAUDE_DELAY_MS",
	"FAKE_CLAUDE_EXIT",
	"FAKE_CLAUDE_TRAP_SIGTERM",
] as const;

const PROMPT = "explain this change\n";

let shim: PathShim;
let originalPath: string | undefined;
let scratchDir: string;
let logCounter = 0;

beforeAll(async () => {
	originalPath = process.env.PATH;
	shim = await createPathShim();
	scratchDir = await mkdtemp(join(tmpdir(), "prreview-engine-"));
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
	for (const key of FAKE_ENV_KEYS) {
		delete process.env[key];
	}
});

/** points PATH at the fakes and the fake at one fixture; returns the log path */
function useFixture(name: string, extra: Record<string, string> = {}): string {
	process.env.PATH = shim.withFakes;
	process.env.FAKE_CLAUDE_FIXTURE = join(FIXTURES_DIR, name);
	logCounter += 1;
	const logPath = join(scratchDir, `invocations-${logCounter}.jsonl`);
	process.env.FAKE_CLAUDE_LOG = logPath;
	for (const [key, value] of Object.entries(extra)) {
		process.env[key] = value;
	}
	return logPath;
}

interface Invocation {
	argv?: string[];
	cwd?: string;
	stdinBytes?: number;
	stdinSha256?: string;
	event?: string;
}

async function readInvocations(logPath: string): Promise<Invocation[]> {
	const raw = await readFile(logPath, "utf8");
	return raw
		.split("\n")
		.filter((line) => line !== "")
		.map((line) => JSON.parse(line) as Invocation);
}

/**
 * Signals are delivered asynchronously: the adapter returns as soon as it has
 * fired SIGTERM, while the child still has to run its handler and append the
 * record. Polling for it is the honest wait — a signal that never arrives
 * still fails, just at the deadline.
 */
const LIFECYCLE_POLL_MS = 10;
const LIFECYCLE_DEADLINE_MS = 2000;
/**
 * Long enough that a child which merely ignored SIGTERM would have finished
 * replaying `simple.jsonl` (13 lines at 40ms ≈ 520ms) and logged "completed".
 */
const REPLAY_OVERRUN_MS = 700;

async function lifecycleEvents(
	logPath: string,
): Promise<(string | undefined)[]> {
	return (await readInvocations(logPath)).map((record) => record.event);
}

async function waitForLifecycleEvent(
	logPath: string,
	event: string,
): Promise<void> {
	const deadline = Date.now() + LIFECYCLE_DEADLINE_MS;
	while (Date.now() < deadline) {
		if ((await lifecycleEvents(logPath)).includes(event)) {
			return;
		}
		await sleep(LIFECYCLE_POLL_MS);
	}
	expect(await lifecycleEvents(logPath)).toContain(event);
}

/** the child died rather than replaying to its end — i.e. SIGKILL landed */
async function expectNeverCompletes(logPath: string): Promise<void> {
	await sleep(REPLAY_OVERRUN_MS);
	expect(await lifecycleEvents(logPath)).not.toContain("completed");
}

/** a passthrough parser: schema re-validation is asserted separately */
const ACCEPT_ANY = { parse: (value: unknown) => value };

function taskSpec(overrides: Partial<TaskSpec> = {}): TaskSpec {
	return {
		stage: "comprehension",
		jsonSchema: '{"type":"object","additionalProperties":false}',
		maxTurns: 30,
		timeoutMs: 10_000,
		systemContract: "contract clause 1",
		outputSchema: ACCEPT_ANY,
		...overrides,
	};
}

function taskInput(overrides: Partial<TaskInput> = {}): TaskInput {
	return { prompt: PROMPT, workspaceDir: scratchDir, ...overrides };
}

function chatInput(overrides: Partial<ChatTurnInput> = {}): ChatTurnInput {
	return {
		prompt: "what does this hunk do?",
		workspaceDir: scratchDir,
		maxTurns: 12,
		timeoutMs: 10_000,
		...overrides,
	};
}

async function drain(
	events: AsyncIterable<EngineEvent>,
): Promise<EngineEvent[]> {
	const collected: EngineEvent[] = [];
	for await (const event of events) {
		collected.push(event);
	}
	return collected;
}

function terminalOf(events: EngineEvent[]): EngineResultEvent {
	const last = events.at(-1);
	if (last === undefined || last.type !== "result") {
		throw new Error("the run produced no terminal result event");
	}
	// exactly one result event, always last (the port's contract)
	expect(events.filter((event) => event.type === "result")).toHaveLength(1);
	return last;
}

const engine = new ClaudeEngine();

describe("ClaudeEngine.probe", () => {
	it("reports the fake's version through the same token logic as the boot probe", async () => {
		useFixture("simple.jsonl");
		expect(await engine.probe()).toEqual({
			kind: "claude",
			version: "2.1.233",
		});
	});

	it("throws raw when the binary fails (the use-cases decide what that means)", async () => {
		useFixture("simple.jsonl", { FAKE_CLAUDE_EXIT: "1" });
		await expect(engine.probe()).rejects.toThrow();
	});
});

describe("ClaudeEngine.runTask argv and prompt delivery", () => {
	it("invokes the §7 baseline exactly, with the schema inline and no --model", async () => {
		const logPath = useFixture("understanding.jsonl");
		await drain(engine.runTask(taskSpec(), taskInput()));

		const [invocation] = await readInvocations(logPath);
		expect(invocation?.argv).toEqual([
			"-p",
			"--output-format",
			"stream-json",
			"--verbose",
			"--allowedTools",
			"Read,Glob,Grep",
			"--disallowedTools",
			"Write,Edit,Bash",
			"--permission-mode",
			"dontAsk",
			"--max-turns",
			"30",
			"--append-system-prompt",
			"contract clause 1",
			"--json-schema",
			'{"type":"object","additionalProperties":false}',
		]);
		expect(invocation?.argv).not.toContain("--model");
		// the fake exits 1 emitting nothing without --verbose, exactly as the
		// real CLI does (CON-001) — its presence above is that contract
		expect(invocation?.argv).toContain("--verbose");
	});

	it("keeps the inline schema under the argv budget (CON-005)", async () => {
		const logPath = useFixture("understanding.jsonl");
		const jsonSchema = JSON.stringify({
			type: "object",
			description: "x".repeat(80_000),
		});
		await drain(engine.runTask(taskSpec({ jsonSchema }), taskInput()));

		const [invocation] = await readInvocations(logPath);
		const passed = invocation?.argv?.at(-1) ?? "";
		expect(Buffer.byteLength(passed)).toBe(Buffer.byteLength(jsonSchema));
		expect(Buffer.byteLength(passed)).toBeLessThan(85_000);
	});

	it("delivers the prompt on stdin, byte-for-byte, and never in argv (SEC-002)", async () => {
		const logPath = useFixture("understanding.jsonl");
		const prompt = `${"line of numbered diff\n".repeat(500)}anchor on the new side`;
		await drain(engine.runTask(taskSpec(), taskInput({ prompt })));

		const [invocation] = await readInvocations(logPath);
		expect(invocation?.stdinBytes).toBe(Buffer.byteLength(prompt));
		expect(invocation?.stdinSha256).toBe(
			createHash("sha256").update(prompt).digest("hex"),
		);
		expect(invocation?.argv).not.toContain(prompt);
	});

	it("runs the child in the engine workspace (REQ-005)", async () => {
		const logPath = useFixture("understanding.jsonl");
		await drain(engine.runTask(taskSpec(), taskInput()));
		const [invocation] = await readInvocations(logPath);
		expect(invocation?.cwd).toBe(scratchDir);
	});

	it("forks a resumed session when asked, and only then (CON-004)", async () => {
		const forkLog = useFixture("understanding.jsonl");
		await drain(
			engine.runTask(
				taskSpec(),
				taskInput({ resume: { sessionId: "sess-a", fork: true } }),
			),
		);
		expect((await readInvocations(forkLog))[0]?.argv?.slice(-3)).toEqual([
			"--resume",
			"sess-a",
			"--fork-session",
		]);

		const plainLog = useFixture("understanding.jsonl");
		await drain(
			engine.runTask(
				taskSpec(),
				taskInput({ resume: { sessionId: "sess-a", fork: false } }),
			),
		);
		const plainArgv = (await readInvocations(plainLog))[0]?.argv ?? [];
		expect(plainArgv.slice(-2)).toEqual(["--resume", "sess-a"]);
		expect(plainArgv).not.toContain("--fork-session");
	});
});

describe("ClaudeEngine.runTask results", () => {
	it("succeeds on a real comprehension capture, with structured output and a read log", async () => {
		useFixture("understanding.jsonl");
		const events = await drain(engine.runTask(taskSpec(), taskInput()));

		const session = events[0];
		expect(session).toEqual({
			type: "session",
			sessionId: "3e043f81-ff29-4077-93fb-90afc632eea3",
			cwd: "/tmp/prreview-capture-33zpuC/miniweb",
			model: "claude-haiku-4-5-20251001",
		});

		const result = terminalOf(events);
		if (!("ok" in result) || !result.ok) {
			throw new Error("expected a successful run");
		}
		expect(Object.keys(result.structuredOutput as object).sort()).toEqual([
			"goalMatch",
			"headline",
			"suggestedEntryPoint",
			"summary",
			"topics",
		]);
		expect(result.model).toBe("claude-haiku-4-5-20251001");
		expect(result.numTurns).toBe(8);
		expect(result.costUsd).toBeGreaterThan(0);
		// CON-007: Read inputs plus Grep/Glob hits harvested from tool_result
		expect(result.readLog).toEqual({
			reads: [
				"/tmp/prreview-capture-33zpuC/miniweb/src/greeting.ts",
				"/tmp/prreview-capture-33zpuC/miniweb/src/main.ts",
			],
			searchHits: [
				"/tmp/prreview-capture-33zpuC/miniweb/src/greeting.ts",
				"/tmp/prreview-capture-33zpuC/miniweb/src/main.ts",
			],
		});
	});

	it("reports every tool call as a tool event, including the schema self-retries (CON-006)", async () => {
		useFixture("understanding.jsonl");
		const events = await drain(engine.runTask(taskSpec(), taskInput()));
		const tools = events.filter((event) => event.type === "tool");
		expect(tools.map((tool) => (tool as { name: string }).name)).toEqual([
			"Read",
			"Read",
			"Glob",
			"Grep",
			"StructuredOutput",
			"StructuredOutput",
			"StructuredOutput",
		]);
		expect(tools[0]).toEqual({
			type: "tool",
			name: "Read",
			target: "/tmp/prreview-capture-33zpuC/miniweb/src/greeting.ts",
		});
	});

	it("survives the user's hook and rate-limit noise (CON-002)", async () => {
		useFixture("hooknoise.jsonl");
		const events = await drain(
			engine.runTask(taskSpec({ outputSchema: undefined }), taskInput()),
		);
		const result = terminalOf(events);
		expect(result).toMatchObject({ ok: true });
	});

	/**
	 * An API failure and a malformed answer both leave a schema task with no
	 * structured output, but they mean opposite things: one is the agent
	 * answering badly, the other is the agent never being reached. Reporting the
	 * first as `schema-violation` told users their model produced bad output
	 * when the truth was a 404 on the model name.
	 */
	it("reports an API failure as api-error, not as a schema violation (CON-003)", async () => {
		useFixture("badmodel.jsonl");
		const events = await drain(engine.runTask(taskSpec(), taskInput()));
		expect(terminalOf(events)).toMatchObject({
			ok: false,
			reason: "api-error",
			terminalReason: "api_error",
		});
	});

	/** the CLI's own explanation is what a user can act on, so it is kept */
	it("carries the API status and the CLI's explanation through", async () => {
		useFixture("badmodel.jsonl");
		const events = await drain(engine.runTask(taskSpec(), taskInput()));
		const result = terminalOf(events);
		if ("ok" in result && result.ok) {
			throw new Error("expected a failure");
		}
		expect(result.stderrTail).toContain("HTTP 404");
		expect(result.stderrTail).toContain("selected model");
	});

	it("maps an exhausted turn budget to schema-violation (CON-006, no retry loop)", async () => {
		useFixture("maxturns.jsonl");
		const events = await drain(engine.runTask(taskSpec(), taskInput()));
		expect(terminalOf(events)).toMatchObject({
			ok: false,
			reason: "schema-violation",
			terminalReason: "max_turns",
		});
	});

	it("re-validates structured output on receipt and rejects it (REQ-007)", async () => {
		useFixture("understanding.jsonl");
		const rejecting = {
			parse: () => {
				throw new Error("intentMap.summary: expected string");
			},
		};
		const events = await drain(
			engine.runTask(taskSpec({ outputSchema: rejecting }), taskInput()),
		);
		expect(terminalOf(events)).toMatchObject({
			ok: false,
			reason: "schema-violation",
		});
	});

	it("treats a stream that ends without a result event as a crash", async () => {
		useFixture("crash.jsonl");
		const events = await drain(engine.runTask(taskSpec(), taskInput()));
		expect(terminalOf(events)).toMatchObject({
			ok: false,
			reason: "crashed",
			terminalReason: null,
		});
	});

	it("carries the stderr tail out of a child that died complaining", async () => {
		useFixture("crash.jsonl", { FAKE_CLAUDE_EXIT: "9" });
		const events = await drain(engine.runTask(taskSpec(), taskInput()));
		const result = terminalOf(events);
		expect(result).toMatchObject({ ok: false, reason: "crashed" });
		expect((result as { stderrTail: string }).stderrTail).toContain(
			"forced failure",
		);
	});

	it("reports a missing agent binary as agent-missing, not a crash", async () => {
		process.env.PATH = shim.gitOnly;
		const events = await drain(engine.runTask(taskSpec(), taskInput()));
		expect(terminalOf(events)).toMatchObject({
			ok: false,
			reason: "agent-missing",
		});
	});
});

describe("ClaudeEngine.chatTurn", () => {
	it("streams ordered text deltas and no schema flag", async () => {
		const logPath = useFixture("chat-stream.jsonl");
		const events = await drain(engine.chatTurn(chatInput()));

		const argv = (await readInvocations(logPath))[0]?.argv ?? [];
		expect(argv).toContain("--include-partial-messages");
		expect(argv).not.toContain("--json-schema");
		expect(argv.slice(10)).toEqual([
			"--max-turns",
			"12",
			"--include-partial-messages",
		]);

		const text = events
			.filter((event) => event.type === "text")
			.map((event) => (event as { text: string }).text);
		// deltas only: the completed assistant block would double every token
		expect(text).toHaveLength(2);
		expect(text.join("")).toContain(
			"**Git merge** creates a new commit that combines two branches",
		);
		expect(terminalOf(events)).toMatchObject({ ok: true });
	});

	it("carries the assistant's final text on the result event", async () => {
		useFixture("chat-stream.jsonl");
		const events = await drain(engine.chatTurn(chatInput()));
		const result = terminalOf(events);
		expect((result as { text: string | null }).text).toContain(
			"**Git rebase**",
		);
	});

	it("forks the analysis session on a thread's first turn (CON-004)", async () => {
		const logPath = useFixture("chat-stream.jsonl");
		await drain(
			engine.chatTurn(
				chatInput({ resume: { sessionId: "analysis-1", fork: true } }),
			),
		);
		expect((await readInvocations(logPath))[0]?.argv?.slice(-3)).toEqual([
			"--resume",
			"analysis-1",
			"--fork-session",
		]);
	});

	it("sends the context-framed prompt on stdin (SEC-004)", async () => {
		const logPath = useFixture("chat-stream.jsonl");
		const prompt = "[viewing src/main.ts, hunk F1h1]\nwhat does this do?";
		await drain(engine.chatTurn(chatInput({ prompt })));
		const [invocation] = await readInvocations(logPath);
		expect(invocation?.stdinBytes).toBe(Buffer.byteLength(prompt));
		expect(invocation?.argv).not.toContain(prompt);
	});
});

describe("ClaudeEngine cancellation and timeouts (SEC-002)", () => {
	it("fails a run that outlives its budget with timed-out", async () => {
		useFixture("understanding.jsonl", { FAKE_CLAUDE_DELAY_MS: "50" });
		const events = await drain(
			engine.runTask(taskSpec({ timeoutMs: 120 }), taskInput()),
		);
		expect(terminalOf(events)).toMatchObject({
			ok: false,
			reason: "timed-out",
		});
	});

	it("kills the child when the consumer stops iterating", async () => {
		const canceller = new ClaudeEngine({ killGraceMs: 100 });
		const logPath = useFixture("simple.jsonl", {
			FAKE_CLAUDE_DELAY_MS: "40",
			FAKE_CLAUDE_TRAP_SIGTERM: "1",
		});

		for await (const event of canceller.runTask(taskSpec(), taskInput())) {
			if (event.type === "session") {
				break;
			}
		}

		await waitForLifecycleEvent(logPath, "sigterm");
		await expectNeverCompletes(logPath);
	});

	it("escalates to SIGKILL when SIGTERM is ignored", async () => {
		const killer = new ClaudeEngine({ killGraceMs: 100 });
		const logPath = useFixture("simple.jsonl", {
			FAKE_CLAUDE_DELAY_MS: "40",
			FAKE_CLAUDE_TRAP_SIGTERM: "1",
		});

		const events = await drain(
			killer.runTask(taskSpec({ timeoutMs: 80 }), taskInput()),
		);
		expect(terminalOf(events)).toMatchObject({
			ok: false,
			reason: "timed-out",
		});

		await waitForLifecycleEvent(logPath, "sigterm");
		await expectNeverCompletes(logPath);
	});
});
