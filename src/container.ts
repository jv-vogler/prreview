import { makeDetectDrift } from "./application/detectDrift";
import { makeOpenReview } from "./application/openReview";
import type { Git } from "./application/ports/Git";
import type { GithubService } from "./application/ports/GithubService";
import type { SessionStore } from "./application/ports/SessionStore";
import { makeRefreshChangeset } from "./application/refreshChangeset";
import { makeResolveChangeset } from "./application/resolveChangeset";
import { makeUpdateCoverage } from "./application/updateCoverage";
import type { Toolchain } from "./domain/session/Toolchain";
import { GitClient } from "./infrastructure/git/GitClient";
import { GhCliGithubService } from "./infrastructure/github/GhCliGithubService";
import { GitRemoteGithubService } from "./infrastructure/github/GitRemoteGithubService";
import { SessionStore as OnDiskSessionStore } from "./infrastructure/store/SessionStore";

export interface BootConfig {
	/** absolute repo toplevel (`git rev-parse --show-toplevel`) */
	repoRoot: string;
	/** absolute path of the `.prreview/` data directory */
	dataDir: string;
}

/**
 * The test seam (PAT-001): use-case tests swap adapters for in-memory fakes
 * here, at the composition root, never by module mocking. Passing
 * `githubService: null` means "no GitHub backend", matching a toolchain of
 * `{github: {kind: 'none'}}`.
 */
export interface ContainerOverrides {
	git?: Git;
	githubService?: GithubService | null;
	store?: SessionStore;
}

/**
 * The composition root (ARCHITECTURE §2): everything is built once at boot
 * and handed down; nothing below this file imports an implementation. It is a
 * function rather than module-level singletons because the GithubService
 * choice is a runtime input — the toolchain probe's result.
 */
export function buildContainer(
	config: BootConfig,
	toolchain: Toolchain,
	overrides: ContainerOverrides = {},
) {
	const git: Git = overrides.git ?? new GitClient(config.repoRoot);

	const githubService: GithubService | null =
		overrides.githubService !== undefined
			? overrides.githubService
			: selectGithubService(toolchain, git, config);

	const store: SessionStore =
		overrides.store ?? new OnDiskSessionStore({ dataDir: config.dataDir });

	const resolveChangeset = makeResolveChangeset({
		git,
		githubService,
		toolchain,
	});

	return {
		git,
		githubService,
		/** M2 placeholder: the Engine port and ClaudeEngine arrive with analysis */
		engine: null,
		store,
		resolveChangeset,
		openReview: makeOpenReview({
			resolveChangeset,
			git,
			githubService,
			store,
			toolchain,
		}),
		refreshChangeset: makeRefreshChangeset({ git, githubService, store }),
		updateCoverage: makeUpdateCoverage({ store }),
		detectDrift: makeDetectDrift({ git, githubService }),
	};
}

export type Container = ReturnType<typeof buildContainer>;

/** The fallback chain of ARCHITECTURE §4, frozen for the whole session. */
function selectGithubService(
	toolchain: Toolchain,
	git: Git,
	config: BootConfig,
): GithubService | null {
	if (toolchain.github.kind === "gh") {
		return new GhCliGithubService(git, config.repoRoot);
	}
	if (toolchain.github.kind === "git-remote") {
		return new GitRemoteGithubService(git);
	}
	return null;
}
