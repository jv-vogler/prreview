import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import { devNull } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import getPort from "get-port";
import {
	createFixtureRepo,
	type FixtureRepo,
} from "../test/helpers/createFixtureRepo";
import { createPathShim, type PathShim } from "../test/helpers/shimPath";

const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

/** two server launches, a browser render, and disk polling live in one test */
const SMOKE_TEST_TIMEOUT_MS = 120_000;
const SERVER_START_TIMEOUT_MS = 30_000;
const RING_UPDATE_TIMEOUT_MS = 30_000;
/** covers the store's ~500ms write debounce with a wide margin */
const DISK_PERSIST_TIMEOUT_MS = 15_000;
const FULLY_COVERED = 100;

const SERVING_URL_PATTERN = /serving at (http:\/\/127\.0\.0\.1:\d+\/)/;

interface RunningServer {
	readonly child: ChildProcess;
	readonly url: string;
	stdout(): string;
	/** settles when the process is gone — captured at spawn, so no exit race */
	readonly exited: Promise<unknown>;
}

test.describe("smoke: built artifact end to end", () => {
	test.setTimeout(SMOKE_TEST_TIMEOUT_MS);

	let repo: FixtureRepo;
	let shim: PathShim;
	const servers: RunningServer[] = [];

	test.beforeEach(async () => {
		repo = await createFixtureRepo();
		shim = await createPathShim();
		await repo.write("src/greeting.ts", COMMITTED_GREETING);
		await repo.commitAll("add greeting");
		// the dirty state under review: one modified tracked file, one hunk
		await repo.write("src/greeting.ts", DIRTY_GREETING);
	});

	test.afterEach(async () => {
		await Promise.all(servers.splice(0).map((server) => stopServer(server)));
		await shim.dispose();
		await repo.dispose();
	});

	test("renders the diff, tracks coverage, and resumes after a kill (REQ-004)", async ({
		page,
	}) => {
		const firstRun = await launchServer();

		// ground truth before any browser exists: a fresh session, nothing covered
		const freshSession = await fetchSession(firstRun.url);
		expect(freshSession.resumed).toBe(false);
		expect(freshSession.coverage.total).toBe(0);

		await page.goto(firstRun.url);

		// the diff actually rendered: the file in the tree, the changed code in the view
		await expect(
			page.getByRole("navigation", { name: "Changed files" }),
		).toContainText("greeting.ts");
		await expect(page.getByText(SMOKE_MARKER).first()).toBeVisible();

		// having the (fully visible) hunk on screen marks it viewed; the
		// server-fed ring moves from the 0 asserted above to fully covered
		const coverageRing = page.getByRole("meter", { name: "Review coverage" });
		await expect(coverageRing).toHaveAttribute(
			"aria-valuenow",
			String(FULLY_COVERED),
			{ timeout: RING_UPDATE_TIMEOUT_MS },
		);

		// the store's write is debounced — wait for it to land on disk, then
		// kill abruptly (SIGKILL): resume must survive a crash, not a clean exit
		await expect
			.poll(() => coverageStatesOnDisk(), { timeout: DISK_PERSIST_TIMEOUT_MS })
			.toContain("viewed");
		await stopServer(firstRun);
		await page.goto("about:blank");

		const secondRun = await launchServer();
		expect(secondRun.stdout()).toContain("session: resumed");

		// coverage restored from .prreview/ BEFORE any page connects — this can
		// only come from disk, not from the browser re-marking hunks viewed
		const resumedSession = await fetchSession(secondRun.url);
		expect(resumedSession.resumed).toBe(true);
		expect(resumedSession.coverage.total).toBe(FULLY_COVERED);

		await page.goto(secondRun.url);
		await expect(page.getByText("resumed", { exact: true })).toBeVisible();
		await expect(coverageRing).toHaveAttribute(
			"aria-valuenow",
			String(FULLY_COVERED),
		);
	});

	/** `dist/cli.js working --no-open` in the fixture repo, fakes-only PATH */
	async function launchServer(): Promise<RunningServer> {
		const port = await getPort();
		const child = spawn(
			process.execPath,
			[CLI_PATH, "working", "--no-open", "--port", String(port)],
			{
				cwd: repo.root,
				env: {
					PATH: shim.withFakes,
					// the machine's git config must not shape what the server sees
					GIT_CONFIG_GLOBAL: devNull,
					GIT_CONFIG_SYSTEM: devNull,
					GIT_TERMINAL_PROMPT: "0",
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		const exited = once(child, "exit");
		const server = await waitForServing(child, exited);
		servers.push(server);
		return server;
	}

	/** every coverage state currently persisted under .prreview/, as one string */
	async function coverageStatesOnDisk(): Promise<string> {
		const sessionsDir = join(repo.root, ".prreview", "sessions");
		const states: string[] = [];
		for (const sessionKey of await readdir(sessionsDir)) {
			try {
				states.push(
					await readFile(
						join(sessionsDir, sessionKey, "coverage.json"),
						"utf8",
					),
				);
			} catch {
				// not written yet — the poll retries
			}
		}
		return states.join("\n");
	}
});

const COMMITTED_GREETING = [
	"export function greet(name: string): string {",
	`\treturn \`hello, \${name}\`;`,
	"}",
	"",
].join("\n");

/** a single-token identifier survives syntax highlighting as one text node */
const SMOKE_MARKER = "prreviewSmokeMarker";

const DIRTY_GREETING = [
	"export function greet(name: string): string {",
	`\tconst ${SMOKE_MARKER} = "changed for the smoke test";`,
	`\treturn \`hello, \${name} (\${${SMOKE_MARKER}})\`;`,
	"}",
	"",
].join("\n");

function waitForServing(
	child: ChildProcess,
	exited: Promise<unknown>,
): Promise<RunningServer> {
	let stdout = "";
	let stderr = "";
	child.stdout?.on("data", (chunk: Buffer) => {
		stdout += chunk.toString();
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});

	return new Promise((resolveServing, rejectServing) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			rejectServing(
				new Error(
					`server did not announce within ${SERVER_START_TIMEOUT_MS}ms\nstdout: ${stdout}\nstderr: ${stderr}`,
				),
			);
		}, SERVER_START_TIMEOUT_MS);

		const checkForUrl = () => {
			const match = SERVING_URL_PATTERN.exec(stdout);
			if (match?.[1] === undefined) {
				return;
			}
			clearTimeout(timer);
			resolveServing({ child, url: match[1], stdout: () => stdout, exited });
		};

		child.stdout?.on("data", checkForUrl);
		child.on("exit", (code) => {
			clearTimeout(timer);
			rejectServing(
				new Error(
					`server exited early (code ${code})\nstdout: ${stdout}\nstderr: ${stderr}`,
				),
			);
		});
	});
}

/**
 * SIGKILL and wait for the process to be gone. Safe to call twice: a child
 * killed by signal has `exitCode === null`, so the check covers `signalCode`
 * too, and `exited` was captured at spawn so it has already settled.
 */
async function stopServer(server: RunningServer): Promise<void> {
	const alreadyGone =
		server.child.exitCode !== null || server.child.signalCode !== null;
	if (!alreadyGone) {
		server.child.kill("SIGKILL");
	}
	await server.exited;
}

interface SessionSnapshot {
	readonly resumed: boolean;
	readonly coverage: { readonly total: number };
}

async function fetchSession(baseUrl: string): Promise<SessionSnapshot> {
	const response = await fetch(new URL("api/session", baseUrl));
	expect(response.status).toBe(200);
	return (await response.json()) as SessionSnapshot;
}
