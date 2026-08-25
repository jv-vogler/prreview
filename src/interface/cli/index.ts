import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import { CommanderError } from "commander";
import getPort, { portNumbers } from "get-port";
import type { Hono } from "hono";
import open from "open";
import { readChangesetFiles } from "../../application/readChangesetFiles";
import { buildContainer } from "../../container";
import { AppError } from "../../domain/errors/AppError";
import { GitClient } from "../../infrastructure/git/GitClient";
import { probeToolchain } from "../../infrastructure/toolchain/probeToolchain";
import { createApp } from "../http/app";
import { createAppEventPublisher } from "../http/events/appEventPublisher";
import { createSseHub } from "../http/events/sseHub";
import { createReviewRunner } from "../http/reviewRunner";
import { createReviewState } from "../http/reviewState";
import { resolveClientDir } from "../http/static";
import { parseCliArgs } from "./args";

const execFileAsync = promisify(execFile);

/** loopback only, unconditionally — there is no --host on purpose (SEC-001) */
const BIND_HOST = "127.0.0.1";
/** how far the get-port walk-up looks before falling back to any free port */
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

	const { ref, announce: changesetAnnounce } = await container.resolveChangeset(
		{
			...(args.target === undefined ? {} : { target: args.target }),
			...(args.base === undefined ? {} : { base: args.base }),
		},
	);
	const files = await readChangesetFiles(
		{ git: container.git, githubService: container.githubService },
		ref,
	);
	const state = createReviewState({ ref, announce: changesetAnnounce, files });

	const hub = createSseHub();
	const runner = createReviewRunner(
		container,
		state,
		createAppEventPublisher(hub),
	);

	// --dev pins the port (the Vite proxy targets it) and leaves static
	// serving to Vite
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
	announce(url, args, changesetAnnounce);

	if (args.open && !args.dev) {
		// fire-and-forget: a browser that cannot be opened (WSL2, headless
		// boxes) must not take the server down with it
		open(url).catch(() => {
			process.stderr.write(
				`prreview: could not open a browser — visit ${url} yourself\n`,
			);
		});
	}
}

/**
 * A pinned port cannot walk, so it has to be free. Checked before serving
 * rather than reported from the failed listen: `serve` emits that error
 * where nothing can catch it, and the reader gets a stack trace instead of
 * the one fact that matters. In dev the answer is never "use another port"
 * anyway, since the Vite proxy targets this one: a server already holding it
 * means the browser is quietly talking to that older process, its stored
 * review and all.
 */
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

/** Boot's one expected failure, so it prints as a sentence and not a stack. */
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

/** What was resolved, the explicit form that overrides it, and where to look. */
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

/**
 * The one catch around boot: usage errors (commander's) exit 2; any other
 * AppError becomes a single human sentence and exit 1; the unexpected prints
 * raw.
 */
function handleBootFailure(error: unknown): never {
	if (error instanceof PortInUseError) {
		process.stderr.write(`prreview: ${error.message}\n`);
		process.exit(FAILURE_EXIT_CODE);
	}
	if (error instanceof CommanderError) {
		// commander already wrote its message (or the help/version text)
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
