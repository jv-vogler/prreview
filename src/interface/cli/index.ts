import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import { CommanderError } from "commander";
import getPort, { portNumbers } from "get-port";
import type { Hono } from "hono";
import open from "open";
import { buildContainer } from "../../container";
import { AppError } from "../../domain/errors/AppError";
import type { Toolchain } from "../../domain/session/Toolchain";
import { GitClient } from "../../infrastructure/git/GitClient";
import { GhCliGithubService } from "../../infrastructure/github/GhCliGithubService";
import { createApp } from "../http/app";
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
	// Temporary, until the real toolchain probe lands (agent detection is a
	// Phase 4 concern): the GitHub side is exactly what GhCliGithubService
	// already answers, so ask it directly rather than inventing a value.
	const toolchain: Toolchain = {
		agent: { kind: "none" },
		github: await new GhCliGithubService(
			new GitClient(repoRoot),
			repoRoot,
		).probe(),
	};
	const container = buildContainer({ repoRoot }, toolchain);

	const { announce: changesetAnnounce } = await container.resolveChangeset({
		...(args.target === undefined ? {} : { target: args.target }),
		...(args.base === undefined ? {} : { base: args.base }),
	});

	// --dev pins the port (the Vite proxy targets it) and leaves static
	// serving to Vite
	const port = args.dev
		? args.port
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

	const app = createApp({ container, clientDir });
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
