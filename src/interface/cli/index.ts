import { join } from "node:path";
import { serve } from "@hono/node-server";
import { CommanderError } from "commander";
import getPort, { portNumbers } from "get-port";
import type { Hono } from "hono";
import open from "open";
import type { OpenedReview } from "../../application/openReview";
import { buildContainer } from "../../container";
import { AppError } from "../../domain/errors/AppError";
import { ChangesetError } from "../../domain/errors/ChangesetError";
import type { Toolchain } from "../../domain/session/Toolchain";
import { GitClient } from "../../infrastructure/git/GitClient";
import { probeToolchain } from "../../infrastructure/toolchain/probe";
import { createApp } from "../http/app";
import { createSseHub } from "../http/events/sseHub";
import { createLifecycle } from "../http/lifecycle";
import { createReviewState } from "../http/reviewState";
import { resolveClientDir } from "../http/static";
import { type CliArgs, parseCliArgs } from "./args";

/** SEC-001: loopback only, unconditionally — there is no --host on purpose. */
const BIND_HOST = "127.0.0.1";
/** how far the get-port walk-up looks before falling back to any free port */
const PORT_WALK_SPAN = 100;
const USAGE_EXIT_CODE = 2;
const FAILURE_EXIT_CODE = 1;
const DATA_DIR_NAME = ".prreview";

/** The startup sequence of ARCHITECTURE §3, top to bottom. */
async function main(): Promise<void> {
	const args = parseCliArgs(process.argv);

	const repoRoot = await detectRepoRoot(process.cwd());
	const toolchain = await probeToolchain(repoRoot);
	const container = buildContainer(
		{ repoRoot, dataDir: join(repoRoot, DATA_DIR_NAME) },
		toolchain,
	);

	const review = await container.openReview({
		...(args.target === undefined ? {} : { target: args.target }),
		...(args.base === undefined ? {} : { base: args.base }),
	});
	const state = createReviewState(review);

	const lifecycle = createLifecycle({ flush: () => container.store.flush() });
	const hub = createSseHub({
		onConnect: () => lifecycle.connectionOpened(),
		onDisconnect: () => lifecycle.connectionClosed(),
	});

	// --dev pins the port (the Vite proxy targets it) and leaves static
	// serving to Vite (ARCHITECTURE §16)
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

	const app = createApp({
		container,
		state,
		hub,
		lifecycle,
		repoRoot,
		boundPort: port,
		dev: args.dev,
		clientDir,
	});
	await listen(app, port);

	const url = `http://${BIND_HOST}:${port}/`;
	announce(review, toolchain, url, args);

	container
		.detectDrift({
			getCurrentRef: () => state.current().ref,
			onDrift: () => hub.publish({ type: "changeset.drifted" }),
		})
		.start();

	if (args.open && !args.dev) {
		// fire-and-forget: a browser that cannot be opened (WSL2, headless
		// boxes — RISK-005) must not take the server down with it
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
		return await new GitClient(cwd).repoRoot();
	} catch (cause) {
		throw new ChangesetError(
			"not-a-repo",
			`prreview must run inside a git repository (none found from ${cwd}).`,
			{ cause },
		);
	}
}

/** REQ-008: what was resolved, the explicit form that overrides it, and the rest of §3's announce. */
function announce(
	review: OpenedReview,
	toolchain: Toolchain,
	url: string,
	args: CliArgs,
): void {
	const sessionLine = review.resumed
		? "session: resumed (coverage restored)"
		: "session: new";
	const openLine =
		args.open && !args.dev
			? "opening your browser…"
			: `open ${url} in your browser`;
	process.stdout.write(
		[
			`prreview: reviewing ${review.announce.resolved}`,
			`  ${review.announce.overrideHint}`,
			`  ${sessionLine}`,
			`  toolchain: ${describeToolchain(toolchain)}`,
			`  serving at ${url} — ${openLine}`,
			"",
		].join("\n"),
	);
}

const GITHUB_BACKEND_SUMMARY: Record<Toolchain["github"]["kind"], string> = {
	gh: "github via gh",
	"git-remote": "github via git remote",
	none: "no github backend",
};

function describeToolchain(toolchain: Toolchain): string {
	const agent =
		toolchain.agent.kind === "claude"
			? `claude ${toolchain.agent.version}`
			: "no agent";
	return `${agent} · ${GITHUB_BACKEND_SUMMARY[toolchain.github.kind]}`;
}

/**
 * CON-003 edge #2 — the ONE catch around boot: usage errors (commander's,
 * and a changeset that cannot be auto-detected) exit 2; any other AppError
 * becomes a single human sentence and exit 1; the unexpected prints raw.
 */
function handleBootFailure(error: unknown): never {
	if (error instanceof CommanderError) {
		// commander already wrote its message (or the help/version text)
		process.exit(error.exitCode === 0 ? 0 : USAGE_EXIT_CODE);
	}
	if (
		error instanceof ChangesetError &&
		error.reason === "cannot-auto-detect"
	) {
		process.stderr.write(`prreview: ${error.message}\n`);
		process.exit(USAGE_EXIT_CODE);
	}
	if (error instanceof AppError) {
		process.stderr.write(`prreview: ${error.message}\n`);
		process.exit(FAILURE_EXIT_CODE);
	}
	console.error(error);
	process.exit(FAILURE_EXIT_CODE);
}

main().catch(handleBootFailure);
