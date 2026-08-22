import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { devNull } from "node:os";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import getPort from "get-port";

const CLI_PATH = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const SERVER_START_TIMEOUT_MS = 30_000;
const SERVING_URL_PATTERN = /serving at (http:\/\/127\.0\.0\.1:\d+\/)/;

export interface RunningServer {
	readonly child: ChildProcess;
	readonly url: string;
	stdout(): string;
	/** settles when the process is gone — captured at spawn, so no exit race */
	readonly exited: Promise<unknown>;
}

export interface LaunchOptions {
	/** the repository to review — the child's cwd */
	cwd: string;
	/** PATH for the child: a `createPathShim()` value, never the machine's */
	pathValue: string;
	/** CLI arguments after the port; default `["working", "--no-open"]` */
	args?: readonly string[];
	/** extra environment, e.g. the `MOCK_AGENT_*` knobs */
	env?: Readonly<Record<string, string>>;
}

/**
 * `dist/cli.js` in a fixture repo, on a stripped PATH, with the served URL
 * read back off stdout. Every e2e spec launches its server through here so
 * all three agree on the hermetic environment: the machine's git config
 * cannot shape what the server sees, and only the fakes on `pathValue` are
 * reachable.
 */
export async function launchPrreview(
	options: LaunchOptions,
): Promise<RunningServer> {
	const port = await getPort();
	const args = options.args ?? ["working", "--no-open"];
	const child = spawn(
		process.execPath,
		[CLI_PATH, ...args, "--port", String(port)],
		{
			cwd: options.cwd,
			env: {
				PATH: options.pathValue,
				GIT_CONFIG_GLOBAL: devNull,
				GIT_CONFIG_SYSTEM: devNull,
				GIT_TERMINAL_PROMPT: "0",
				...options.env,
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const exited = once(child, "exit");
	return waitForServing(child, exited);
}

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
export async function stopServer(server: RunningServer): Promise<void> {
	const alreadyGone =
		server.child.exitCode !== null || server.child.signalCode !== null;
	if (!alreadyGone) {
		server.child.kill("SIGKILL");
	}
	await server.exited;
}

/** a GET against the running server, asserted 200, parsed as JSON */
export async function fetchApi<T>(baseUrl: string, path: string): Promise<T> {
	const response = await fetch(new URL(path, baseUrl));
	expect(response.status).toBe(200);
	return (await response.json()) as T;
}
