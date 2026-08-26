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
	readonly exited: Promise<unknown>;
}

export interface LaunchOptions {
	cwd: string;
	pathValue: string;
	args?: readonly string[];
	env?: Readonly<Record<string, string>>;
}

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

export async function stopServer(server: RunningServer): Promise<void> {
	const alreadyGone =
		server.child.exitCode !== null || server.child.signalCode !== null;
	if (!alreadyGone) {
		server.child.kill("SIGKILL");
	}
	await server.exited;
}

export async function fetchApi<T>(baseUrl: string, path: string): Promise<T> {
	const response = await fetch(new URL(path, baseUrl));
	expect(response.status).toBe(200);
	return (await response.json()) as T;
}
