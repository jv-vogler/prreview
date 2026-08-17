import {
	ANALYSIS_TIMEOUT_MS,
	CHAT_TIMEOUT_MS,
} from "./application/analysis/limits";
import { makeChatTurn } from "./application/chatTurn";
import { makeDetectDrift } from "./application/detectDrift";
import { makeOpenReview } from "./application/openReview";
import type { Engine } from "./application/ports/Engine";
import type { PublishEvent } from "./application/ports/EventPublisher";
import type { Git } from "./application/ports/Git";
import type { GithubService } from "./application/ports/GithubService";
import type { RunManager } from "./application/ports/RunManager";
import type { SessionStore } from "./application/ports/SessionStore";
import { makeRefreshChangeset } from "./application/refreshChangeset";
import { makeResolveChangeset } from "./application/resolveChangeset";
import { makeRunAnalysis } from "./application/runAnalysis";
import { makeUpdateCoverage } from "./application/updateCoverage";
import { makeUpdateWalkthroughProgress } from "./application/updateWalkthroughProgress";
import type { Toolchain } from "./domain/session/Toolchain";
import { ClaudeEngine } from "./infrastructure/engine/ClaudeEngine";
import { createRunManager } from "./infrastructure/engine/runManager";
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
	runManager?: RunManager;
	/**
	 * Where run, annotation, and chat events go — wired to the SSE hub's
	 * publish by the interface layer. This is real production wiring rather
	 * than a test seam; it lives here because the hub is built after the
	 * container. Omitted, events are dropped, which is exactly right for a
	 * container with no server attached.
	 */
	publish?: PublishEvent;
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

	const publish: PublishEvent = overrides.publish ?? (() => {});

	const runManager: RunManager =
		overrides.runManager ??
		createRunManager({
			publish,
			timeoutMsByLane: {
				analysis: ANALYSIS_TIMEOUT_MS,
				chat: CHAT_TIMEOUT_MS,
			},
		});

	const engineWorkspaces = createEngineWorkspaces({
		git,
		repoRoot: config.repoRoot,
		cacheDir: config.cacheDir,
	});

	const resolveChangeset = makeResolveChangeset({
		git,
		githubService,
		toolchain,
	});

	const updateCoverage = makeUpdateCoverage({ store });

	return {
		git,
		githubService,
		engine,
		engineWorkspaces,
		runManager,
		store,
		publish,
		resolveChangeset,
		openReview: makeOpenReview({
			resolveChangeset,
			git,
			githubService,
			store,
			toolchain,
		}),
		refreshChangeset: makeRefreshChangeset({ git, githubService, store }),
		updateCoverage,
		detectDrift: makeDetectDrift({ git, githubService }),
		runAnalysis: makeRunAnalysis({
			engine,
			runManager,
			workspaces: engineWorkspaces,
			git,
			store,
			publish,
		}),
		chatTurn: makeChatTurn({
			engine,
			runManager,
			workspaces: engineWorkspaces,
			store,
			publish,
		}),
		updateWalkthroughProgress: makeUpdateWalkthroughProgress({
			store,
			updateCoverage,
		}),
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
	runManager: RunManager;
	store: SessionStore;
	publish: PublishEvent;
	resolveChangeset: ReturnType<typeof makeResolveChangeset>;
	openReview: ReturnType<typeof makeOpenReview>;
	refreshChangeset: ReturnType<typeof makeRefreshChangeset>;
	updateCoverage: ReturnType<typeof makeUpdateCoverage>;
	detectDrift: ReturnType<typeof makeDetectDrift>;
	runAnalysis: ReturnType<typeof makeRunAnalysis>;
	chatTurn: ReturnType<typeof makeChatTurn>;
	updateWalkthroughProgress: ReturnType<typeof makeUpdateWalkthroughProgress>;
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
