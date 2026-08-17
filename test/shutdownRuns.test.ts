import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ClaudeEngine } from "../src/infrastructure/engine/ClaudeEngine";
import { createTestApp, type TestApp } from "./helpers/createTestApp";
import { createPathShim, type PathShim } from "./helpers/shimPath";

/**
 * SEC-002's shutdown promise, asserted the only way that means anything: with a
 * real child process. prreview runs through `npx` — a tab that closes must not
 * leave a `claude` running on the user's machine, and a child that ignores
 * SIGTERM must still be gone when the process exits.
 */

const FIXTURE = fileURLToPath(
	new URL("./fixtures/claude/simple.jsonl", import.meta.url),
);
/** slow enough that the child is provably mid-replay when shutdown starts */
const REPLAY_DELAY_MS = 200;
/** SEC-002's escalation, shortened so the test costs 100ms instead of 5s */
const KILL_GRACE_MS = 100;
const GRACE_MS = 10;
const DEADLINE_MS = 5_000;
const POLL_STEP_MS = 10;

let shim: PathShim;
let originalPath: string | undefined;
let scratchDir: string;

beforeAll(async () => {
	originalPath = process.env.PATH;
	shim = await createPathShim();
	scratchDir = await mkdtemp(join(tmpdir(), "prreview-shutdown-"));
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
	delete process.env.FAKE_CLAUDE_DELAY_MS;
	delete process.env.FAKE_CLAUDE_LOG;
	delete process.env.FAKE_CLAUDE_TRAP_SIGTERM;
});

async function appWithARunningChild(logPath: string): Promise<TestApp> {
	process.env.PATH = shim.withFakes;
	process.env.FAKE_CLAUDE_FIXTURE = FIXTURE;
	process.env.FAKE_CLAUDE_DELAY_MS = String(REPLAY_DELAY_MS);
	process.env.FAKE_CLAUDE_LOG = logPath;

	const app = await createTestApp({
		agent: { kind: "claude", version: "2.1.233" },
		engine: new ClaudeEngine({ killGraceMs: KILL_GRACE_MS }),
		// the engine spawns with the workspace as cwd, so it has to exist
		repoRoot: scratchDir,
		graceMs: GRACE_MS,
	});
	const accepted = await app.app.request("/api/analysis", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ task: "comprehension" }),
	});
	expect(accepted.status).toBe(202);
	return app;
}

/** the fake logs its own pid, which is how "is it gone?" becomes a question */
async function spawnedChildPid(logPath: string): Promise<number> {
	await until(async () => (await invocations(logPath)).length > 0);
	const [record] = await invocations(logPath);
	return record.pid;
}

async function invocations(logPath: string): Promise<{ pid: number }[]> {
	try {
		const raw = await readFile(logPath, "utf8");
		return raw
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { pid: number });
	} catch {
		return [];
	}
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** the tab goes away, which is the only shutdown trigger there is (§3) */
async function shutdown(app: TestApp): Promise<void> {
	app.lifecycle.connectionOpened();
	app.lifecycle.connectionClosed();
	await until(async () => app.exitCodes.includes(0));
}

async function until(condition: () => Promise<boolean>): Promise<void> {
	const deadline = Date.now() + DEADLINE_MS;
	while (!(await condition())) {
		if (Date.now() > deadline) {
			throw new Error("timed out waiting for a condition");
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_STEP_MS));
	}
}

describe("shutdown with an analysis in flight", () => {
	it("leaves no claude child behind", async () => {
		const logPath = join(scratchDir, "cooperative.log");
		const app = await appWithARunningChild(logPath);
		const pid = await spawnedChildPid(logPath);
		expect(isAlive(pid)).toBe(true);

		await shutdown(app);

		expect(isAlive(pid)).toBe(false);
		const [run] = app.container.runManager.list();
		expect(run.status).toBe("cancelled");
	});

	it("escalates to SIGKILL for a child that ignores SIGTERM", async () => {
		const logPath = join(scratchDir, "stubborn.log");
		process.env.FAKE_CLAUDE_TRAP_SIGTERM = "1";
		const app = await appWithARunningChild(logPath);
		const pid = await spawnedChildPid(logPath);
		expect(isAlive(pid)).toBe(true);

		await shutdown(app);

		expect(isAlive(pid)).toBe(false);
		// it was killed rather than allowed to finish its replay
		const raw = await readFile(logPath, "utf8");
		expect(raw).toContain('"event":"sigterm"');
		expect(raw).not.toContain('"event":"completed"');
	});
});
