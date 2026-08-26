import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import { CommanderError } from "commander";
import getPort, { portNumbers } from "get-port";
import type { Hono } from "hono";
import open from "open";
import { readChangesetFiles } from "../../application/readChangesetFiles";
import { buildContainer, type Container } from "../../container";
import { AppError } from "../../domain/errors/AppError";
import { GitClient } from "../../infrastructure/git/GitClient";
import { probeToolchain } from "../../infrastructure/toolchain/probeToolchain";
import { createApp } from "../http/app";
import { createAppEventPublisher } from "../http/events/appEventPublisher";
import { createSseHub } from "../http/events/sseHub";
import { createReviewRunner } from "../http/reviewRunner";
import { type CurrentChangeset, createReviewState } from "../http/reviewState";
import { resolveClientDir } from "../http/static";
import { type CliArgs, parseCliArgs } from "./args";

const execFileAsync = promisify(execFile);

const BIND_HOST = "127.0.0.1";

const PORT_WALK_SPAN = 100;
const USAGE_EXIT_CODE = 2;
const FAILURE_EXIT_CODE = 1;

async function main(): Promise<void> {
	const args = parseCliArgs(process.argv);

	const repoRoot = await detectRepoRoot(process.cwd());
	const toolchain = await probeToolchain(new GitClient(repoRoot), repoRoot);
	const container = buildContainer({ repoRoot }, toolchain);
	await container.sessionStore.ensureExcluded(
		await container.git.gitCommonDir(),
	);

	const resolveCurrentChangeset = () => currentChangeset(container, args);
	const initial = await resolveCurrentChangeset();
	const state = createReviewState(initial, resolveCurrentChangeset);

	const hub = createSseHub();
	const runner = createReviewRunner(
		container,
		state,
		createAppEventPublisher(hub),
	);

	const port = args.dev
		? await pinnedPort(args.port)
		: await getPort({
				host: BIND_HOST,
				port: portNumbers(args.port, args.port + PORT_WALK_SPAN),
			});
	const clientDir = args.dev ? null : await resolveClientDir();
	if (!args.dev && clientDir === null) {
		process.stderr.write(
			"prreview: dist/client is missing (build not run?) — serving the API only\n",
		);
	}

	const app = createApp({ container, state, runner, hub, repoRoot, clientDir });
	await listen(app, port);

	const url = `http://${BIND_HOST}:${port}/`;
	announce(url, args, initial.announce);

	if (args.open && !args.dev) {
		open(url).catch(() => {
			process.stderr.write(
				`prreview: could not open a browser — visit ${url} yourself\n`,
			);
		});
	}
}

async function currentChangeset(
	container: Container,
	args: CliArgs,
): Promise<CurrentChangeset> {
	const { ref, announce } = await container.resolveChangeset({
		...(args.target === undefined ? {} : { target: args.target }),
		...(args.base === undefined ? {} : { base: args.base }),
	});
	const files = await readChangesetFiles(
		{ git: container.git, githubService: container.githubService },
		ref,
	);
	return { ref, announce, files };
}

async function pinnedPort(port: number): Promise<number> {
	const free = await getPort({
		host: BIND_HOST,
		port: portNumbers(port, port + 1),
	});
	if (free !== port) {
		throw new PortInUseError(
			`port ${port} is already in use, most likely by a prreview still serving there. Stop that one, or start this with --port <number>.`,
		);
	}
	return port;
}

class PortInUseError extends Error {}

function listen(app: Hono, port: number): Promise<void> {
	return new Promise((resolveListening, rejectListening) => {
		const server = serve({ fetch: app.fetch, hostname: BIND_HOST, port }, () =>
			resolveListening(),
		);
		server.on("error", rejectListening);
	});
}

async function detectRepoRoot(cwd: string): Promise<string> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["rev-parse", "--show-toplevel"],
			{
				cwd,
			},
		);
		return stdout.trim();
	} catch (cause) {
		throw new Error(
			`prreview must run inside a git repository (none found from ${cwd}).`,
			{ cause },
		);
	}
}

function announce(
	url: string,
	args: { open: boolean; dev: boolean },
	changeset: { resolved: string; overrideHint: string },
): void {
	const openLine =
		args.open && !args.dev
			? "opening your browser…"
			: `open ${url} in your browser`;
	process.stdout.write(
		[
			`prreview: reviewing ${changeset.resolved}`,
			`  ${changeset.overrideHint}`,
			`  serving at ${url} — ${openLine}`,
			"",
		].join("\n"),
	);
}

function handleBootFailure(error: unknown): never {
	if (error instanceof PortInUseError) {
		process.stderr.write(`prreview: ${error.message}\n`);
		process.exit(FAILURE_EXIT_CODE);
	}
	if (error instanceof CommanderError) {
		process.exit(error.exitCode === 0 ? 0 : USAGE_EXIT_CODE);
	}
	if (error instanceof AppError) {
		process.stderr.write(`prreview: ${error.message}\n`);
		process.exit(FAILURE_EXIT_CODE);
	}
	console.error(error);
	process.exit(FAILURE_EXIT_CODE);
}

main().catch(handleBootFailure);
