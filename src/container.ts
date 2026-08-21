import type { Clock } from "./application/ports/Clock";
import type { Git } from "./application/ports/Git";
import type { GithubService } from "./application/ports/GithubService";
import {
	makeResolveChangeset,
	type ResolveChangeset,
} from "./application/resolveChangeset";
import type { Toolchain } from "./domain/session/Toolchain";
import { SystemClock } from "./infrastructure/clock/SystemClock";
import { GitClient } from "./infrastructure/git/GitClient";
import { GhCliGithubService } from "./infrastructure/github/GhCliGithubService";

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
}

/**
 * The composition root (CON-009): everything is built once at boot and
 * handed down; nothing below this file imports an implementation directly.
 *
 * `toolchain` is a required parameter, not something this function invents —
 * the real probe is a Phase 4 concern (the agent side of it does not exist
 * yet); the CLI edge supplies whatever it can determine today.
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

	const resolveChangeset = makeResolveChangeset({
		git,
		githubService,
		toolchain,
	});

	return { clock, git, githubService, toolchain, resolveChangeset };
}

export interface Container {
	clock: Clock;
	git: Git;
	githubService: GithubService | null;
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
