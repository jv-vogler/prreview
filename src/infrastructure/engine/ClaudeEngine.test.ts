import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";
import { createPathShim, type PathShim } from "../../../test/helpers/shimPath";
import type { EngineEvent } from "../../application/ports/Engine";
import { ClaudeEngine } from "./ClaudeEngine";

const FIXTURES_DIR = fileURLToPath(
	new URL("../../../test/fixtures/claude/", import.meta.url),
);

const OUTPUT_SCHEMA = {
	parse: (value: unknown) => {
		if (
			typeof value !== "object" ||
			value === null ||
			typeof (value as { ok?: unknown }).ok !== "boolean"
		) {
			throw new Error("not a valid pass output");
		}
		return value;
	},
};

const KILL_GRACE_MS = 30;
const REPLAY_LONGER_THAN_THE_TEST_MS = 5000;
const LOG_POLL_MS = 5;
const LOG_WAIT_LIMIT_MS = 2000;

async function waitForLine(path: string): Promise<void> {
	const deadline = Date.now() + LOG_WAIT_LIMIT_MS;
	while (Date.now() < deadline) {
		const seen = await readFile(path, "utf8").catch(() => "");
		if (seen.includes("\n")) {
			return;
		}
		await new Promise((settle) => setTimeout(settle, LOG_POLL_MS));
	}
	throw new Error(`the fake never wrote to ${path}`);
}

const TASK = {
	jsonSchema: '{"type":"object"}',
	maxTurns: 5,
	idleTimeoutMs: 5000,
	systemContract: "contract",
	outputSchema: OUTPUT_SCHEMA,
};

async function collect(
	iterable: AsyncIterable<EngineEvent>,
): Promise<EngineEvent[]> {
	const events: EngineEvent[] = [];
	for await (const event of iterable) {
		events.push(event);
	}
	return events;
}

function withFixture(shim: PathShim, fixture: string) {
	process.env.PATH = shim.withFakes;
	process.env.FAKE_CLAUDE_FIXTURE = `${FIXTURES_DIR}${fixture}`;
}

describe("ClaudeEngine", () => {
	let shim: PathShim;
	let originalPath: string | undefined;

	beforeAll(async () => {
		shim = await createPathShim();
	});

	afterAll(async () => {
		await shim.dispose();
	});

	beforeEach(() => {
		originalPath = process.env.PATH;
	});

	afterEach(() => {
		process.env.PATH = originalPath;
		delete process.env.FAKE_CLAUDE_FIXTURE;
		delete process.env.FAKE_CLAUDE_EXIT;
		delete process.env.FAKE_CLAUDE_LOG;
		delete process.env.FAKE_CLAUDE_TRAP_SIGTERM;
		delete process.env.FAKE_CLAUDE_DELAY_MS;
	});

	it("probes the fake binary's version", async () => {
		process.env.PATH = shim.withFakes;
		const engine = new ClaudeEngine();
		const info = await engine.probe();
		expect(info).toEqual({ kind: "claude", version: "2.1.239" });
	});

	it("reports agent-missing when the binary is absent", async () => {
		process.env.PATH = shim.gitOnly;
		const engine = new ClaudeEngine();
		const events = await collect(
			engine.runTask(TASK, { prompt: "review this", workspaceDir: "/tmp" }),
		);
		const [result] = events;
		expect(result).toMatchObject({
			type: "result",
			ok: false,
			reason: "agent-missing",
		});
	});

	it("streams tool events and yields exactly one successful result", async () => {
		withFixture(shim, "success.jsonl");
		const engine = new ClaudeEngine();
		const events = await collect(
			engine.runTask(TASK, { prompt: "review this", workspaceDir: "/tmp" }),
		);
		expect(events[0]).toMatchObject({
			type: "session",
			sessionId: "sess-success",
		});
		expect(events[1]).toMatchObject({
			type: "tool",
			name: "Read",
			target: "src/index.ts",
		});
		const result = events.at(-1);
		expect(result).toMatchObject({
			type: "result",
			ok: true,
			structuredOutput: { ok: true },
		});
	});

	it("reports crashed when the stream ends with no result event", async () => {
		withFixture(shim, "crash.jsonl");
		const engine = new ClaudeEngine();
		const events = await collect(
			engine.runTask(TASK, { prompt: "review this", workspaceDir: "/tmp" }),
		);
		expect(events.at(-1)).toMatchObject({
			type: "result",
			ok: false,
			reason: "crashed",
		});
	});

	it("accumulates the plan across incremental TaskCreate/TaskUpdate calls", async () => {
		withFixture(shim, "task-plan.jsonl");
		const engine = new ClaudeEngine();
		const events = await collect(
			engine.runTask(TASK, { prompt: "review this", workspaceDir: "/tmp" }),
		);
		const plans = events.filter((event) => event.type === "plan");
		expect(plans).toHaveLength(4);
		expect(plans.at(-1)).toEqual({
			type: "plan",
			steps: [
				{ label: "Find the ticket", state: "done" },
				{ label: "Read the big picture", state: "active" },
			],
		});
	});

	it("yields only the tool event when a Task call's input is unrecognized", async () => {
		withFixture(shim, "task-plan-malformed.jsonl");
		const engine = new ClaudeEngine();
		const events = await collect(
			engine.runTask(TASK, { prompt: "review this", workspaceDir: "/tmp" }),
		);
		expect(events[1]).toMatchObject({ type: "tool", name: "TaskCreate" });
		expect(events.some((event) => event.type === "plan")).toBe(false);
	});

	it("reports api-error, not schema-violation, when the API call itself failed", async () => {
		withFixture(shim, "api-error.jsonl");
		const engine = new ClaudeEngine();
		const events = await collect(
			engine.runTask(TASK, { prompt: "review this", workspaceDir: "/tmp" }),
		);
		expect(events.at(-1)).toMatchObject({
			type: "result",
			ok: false,
			reason: "api-error",
			stderrTail: expect.stringContaining("HTTP 429"),
		});
	});

	it("reports out-of-turns, not schema-violation, when the budget ran out", async () => {
		withFixture(shim, "max-turns.jsonl");
		const engine = new ClaudeEngine();
		const events = await collect(
			engine.runTask(TASK, { prompt: "review this", workspaceDir: "/tmp" }),
		);
		expect(events.at(-1)).toMatchObject({
			type: "result",
			ok: false,
			reason: "out-of-turns",
		});
	});

	it("reports schema-violation when structured output fails re-validation", async () => {
		withFixture(shim, "bad-schema-output.jsonl");
		const engine = new ClaudeEngine();
		const events = await collect(
			engine.runTask(TASK, { prompt: "review this", workspaceDir: "/tmp" }),
		);
		expect(events.at(-1)).toMatchObject({
			type: "result",
			ok: false,
			reason: "schema-violation",
		});
	});

	it("delivers the prompt on stdin, never as an argv member", async () => {
		withFixture(shim, "success.jsonl");
		const logPath = `${FIXTURES_DIR}../claude-invocation.log`;
		process.env.FAKE_CLAUDE_LOG = logPath;
		try {
			const engine = new ClaudeEngine();
			const secret = "a secret prompt nobody should see in a process list";
			await collect(
				engine.runTask(TASK, { prompt: secret, workspaceDir: "/tmp" }),
			);

			const { readFile, rm } = await import("node:fs/promises");
			const log = await readFile(logPath, "utf8");
			const [record] = log
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(record.argv.join(" ")).not.toContain(secret);
			expect(record.stdinBytes).toBe(Buffer.byteLength(secret));
			await rm(logPath, { force: true });
		} finally {
			delete process.env.FAKE_CLAUDE_LOG;
		}
	});

	it("kills a child that refuses to die on SIGTERM", async () => {
		withFixture(shim, "success.jsonl");
		const logPath = join(
			await mkdtemp(join(tmpdir(), "prreview-kill-")),
			"log",
		);
		process.env.FAKE_CLAUDE_LOG = logPath;
		process.env.FAKE_CLAUDE_TRAP_SIGTERM = "1";
		process.env.FAKE_CLAUDE_DELAY_MS = String(REPLAY_LONGER_THAN_THE_TEST_MS);

		const engine = new ClaudeEngine({ killGraceMs: KILL_GRACE_MS });
		const events = engine
			.runTask(TASK, {
				prompt: "review this",
				workspaceDir: "/tmp",
			})
			[Symbol.asyncIterator]();
		const running = events.next().catch(() => undefined);

		await waitForLine(logPath);
		await engine.stop();
		await running;

		const lifecycle = (await readFile(logPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(lifecycle).toContainEqual({ event: "sigterm" });
		expect(lifecycle).not.toContainEqual({ event: "completed" });
	});
});
