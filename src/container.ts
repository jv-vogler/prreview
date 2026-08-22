import { join } from "node:path";
import type { Clock } from "./application/ports/Clock";
import type { Engine } from "./application/ports/Engine";
import type { Git } from "./application/ports/Git";
import type { GithubService } from "./application/ports/GithubService";
import type { SessionStore } from "./application/ports/SessionStore";
import {
	makeResolveChangeset,
	type ResolveChangeset,
} from "./application/resolveChangeset";
import type { Toolchain } from "./domain/session/Toolchain";
import { SystemClock } from "./infrastructure/clock/SystemClock";
import { ClaudeEngine } from "./infrastructure/engine/ClaudeEngine";
import { GitClient } from "./infrastructure/git/GitClient";
import { GhCliGithubService } from "./infrastructure/github/GhCliGithubService";
import { SessionStore as FileSessionStore } from "./infrastructure/store/SessionStore";

export interface BootConfig {
	/** absolute repo toplevel (`git rev-parse --show-toplevel`) */
	repoRoot: string;
}

/**
 * The test seam: use-case tests swap adapters for fakes here, at the
 * composition root, never by module mocking (CON-013).
 */
export interface ContainerOverrides {
	clock?: Clock;
	git?: Git;
	/** null = no GitHub backend at all, matching toolchain.github.kind "none" */
	githubService?: GithubService | null;
	/** null = no agent at all, matching toolchain.agent.kind "none" (REQ-009) */
	engine?: Engine | null;
	sessionStore?: SessionStore;
}

/**
 * The composition root (CON-009): everything is built once at boot and
 * handed down; nothing below this file imports an implementation directly.
 *
 * `toolchain` is a required parameter, not something this function invents —
 * the CLI edge probes it (infrastructure/toolchain/probeToolchain.ts) and
 * hands the result down.
 */
export function buildContainer(
	config: BootConfig,
	toolchain: Toolchain,
	overrides: ContainerOverrides = {},
): Container {
	const clock: Clock = overrides.clock ?? new SystemClock();
	const git: Git = overrides.git ?? new GitClient(config.repoRoot);
	const githubService: GithubService | null =
		overrides.githubService !== undefined
			? overrides.githubService
			: selectGithubService(toolchain, git, config);
	const engine: Engine | null =
		overrides.engine !== undefined
			? overrides.engine
			: toolchain.agent.kind === "claude"
				? new ClaudeEngine()
				: null;
	const sessionStore: SessionStore =
		overrides.sessionStore ??
		new FileSessionStore({ dataDir: join(config.repoRoot, ".prreview") });

	const resolveChangeset = makeResolveChangeset({
		git,
		githubService,
		toolchain,
	});

	return {
		clock,
		git,
		githubService,
		engine,
		sessionStore,
		toolchain,
		resolveChangeset,
	};
}

export interface Container {
	clock: Clock;
	git: Git;
	githubService: GithubService | null;
	engine: Engine | null;
	sessionStore: SessionStore;
	toolchain: Toolchain;
	resolveChangeset: ResolveChangeset;
}

/** Mirrors GithubService selection by the probed toolchain; no fallback backend yet. */
function selectGithubService(
	toolchain: Toolchain,
	git: Git,
	config: BootConfig,
): GithubService | null {
	return toolchain.github.kind === "gh"
		? new GhCliGithubService(git, config.repoRoot)
		: null;
}
