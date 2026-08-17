import { makeDetectDrift } from "./application/detectDrift";
import { makeOpenReview } from "./application/openReview";
import type { Engine } from "./application/ports/Engine";
import type { Git } from "./application/ports/Git";
import type { GithubService } from "./application/ports/GithubService";
import type { SessionStore } from "./application/ports/SessionStore";
import { makeRefreshChangeset } from "./application/refreshChangeset";
import { makeResolveChangeset } from "./application/resolveChangeset";
import { makeUpdateCoverage } from "./application/updateCoverage";
import type { Toolchain } from "./domain/session/Toolchain";
import { ClaudeEngine } from "./infrastructure/engine/ClaudeEngine";
import {
	createEngineWorkspaces,
	type EngineWorkspaces,
} from "./infrastructure/engine/workspace";
import { GitClient } from "./infrastructure/git/GitClient";
import { GhCliGithubService } from "./infrastructure/github/GhCliGithubService";
import { GitRemoteGithubService } from "./infrastructure/github/GitRemoteGithubService";
import { SessionStore as OnDiskSessionStore } from "./infrastructure/store/SessionStore";

export interface BootConfig {
	/** absolute repo toplevel (`git rev-parse --show-toplevel`) */
	repoRoot: string;
	/** absolute path of the `.prreview/` data directory */
	dataDir: string;
	/**
	 * Root for engine workspaces — detached checkouts of the reviewed revision
	 * (ARCHITECTURE §7). Never inside the repo; the CLI defaults it to
	 * `defaultEngineCacheDir()` and tests point it at a temp directory.
	 */
	cacheDir: string;
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
	/** null = no agent CLI on this machine, matching `{agent: {kind: 'none'}}` */
	engine?: Engine | null;
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
): Container {
	const git: Git = overrides.git ?? new GitClient(config.repoRoot);

	const githubService: GithubService | null =
		overrides.githubService !== undefined
			? overrides.githubService
			: selectGithubService(toolchain, git, config);

	const store: SessionStore =
		overrides.store ?? new OnDiskSessionStore({ dataDir: config.dataDir });

	const engine: Engine | null =
		overrides.engine !== undefined ? overrides.engine : selectEngine(toolchain);

	const resolveChangeset = makeResolveChangeset({
		git,
		githubService,
		toolchain,
	});

	return {
		git,
		githubService,
		engine,
		engineWorkspaces: createEngineWorkspaces({
			git,
			repoRoot: config.repoRoot,
			cacheDir: config.cacheDir,
		}),
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

/**
 * Written out rather than inferred from the returned literal, because
 * inference would type `engine` as `null` on a machine without an agent and
 * every consumer downstream would silently narrow to "there is no engine"
 * (RISK-011). The use-case members stay inferred from their factories — those
 * have no such ambiguity.
 */
export interface Container {
	git: Git;
	githubService: GithubService | null;
	engine: Engine | null;
	engineWorkspaces: EngineWorkspaces;
	store: SessionStore;
	resolveChangeset: ReturnType<typeof makeResolveChangeset>;
	openReview: ReturnType<typeof makeOpenReview>;
	refreshChangeset: ReturnType<typeof makeRefreshChangeset>;
	updateCoverage: ReturnType<typeof makeUpdateCoverage>;
	detectDrift: ReturnType<typeof makeDetectDrift>;
}

/**
 * The engine exists exactly when the boot probe found an agent CLI (REQ-004):
 * with `agent: {kind: 'none'}` every AI surface is off and the M1 viewer runs
 * unchanged. Mirrors selectGithubService.
 */
function selectEngine(toolchain: Toolchain): Engine | null {
	return toolchain.agent.kind === "claude" ? new ClaudeEngine() : null;
}

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
