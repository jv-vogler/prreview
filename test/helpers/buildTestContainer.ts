import { buildContainer, type Container } from "../../src/container";
import type { Toolchain } from "../../src/domain/session/Toolchain";
import { FakeGit, type FakeGitState } from "./FakeGit";
import { FakeGithubService, type FakeGithubState } from "./FakeGithubService";
import { InMemorySessionStore } from "./InMemorySessionStore";

export interface TestContainerSetup {
	git?: FakeGitState;
	/** null = no GitHub backend at all (toolchain github kind "none") */
	github?: FakeGithubState | null;
	agent?: Toolchain["agent"];
}

export interface TestContainer {
	container: Container;
	git: FakeGit;
	githubService: FakeGithubService | null;
	store: InMemorySessionStore;
	toolchain: Toolchain;
}

const TEST_BOOT_CONFIG = {
	repoRoot: "/repo",
	dataDir: "/repo/.prreview",
	// engine workspaces are never materialized in a fake-git container
	cacheDir: "/cache/prreview",
};

/**
 * The PAT-001 seam in one call: a real container whose adapters are the
 * in-memory fakes, injected through buildContainer's overrides — use-case
 * tests exercise exactly the wiring production runs, never module mocks.
 */
export function buildTestContainer(
	setup: TestContainerSetup = {},
): TestContainer {
	const git = new FakeGit(setup.git);
	const githubService =
		setup.github === null ? null : new FakeGithubService(setup.github ?? {});
	const store = new InMemorySessionStore();
	const toolchain: Toolchain = {
		agent: setup.agent ?? { kind: "none" },
		github: { kind: githubServiceKind(setup.github) },
	};
	const container = buildContainer(TEST_BOOT_CONFIG, toolchain, {
		git,
		githubService,
		store,
	});
	return { container, git, githubService, store, toolchain };
}

function githubServiceKind(
	github: FakeGithubState | null | undefined,
): Toolchain["github"]["kind"] {
	if (github === null) {
		return "none";
	}
	return github?.kind ?? "gh";
}
