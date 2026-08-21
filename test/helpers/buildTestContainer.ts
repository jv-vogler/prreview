import { buildContainer, type Container } from "../../src/container";
import type { Toolchain } from "../../src/domain/session/Toolchain";
import { FakeGit, type FakeGitState } from "./FakeGit";
import { FakeGithubService, type FakeGithubState } from "./FakeGithubService";

export interface TestContainerSetup {
	git?: FakeGitState;
	/** null = no GitHub backend at all (toolchain github kind "none") */
	github?: FakeGithubState | null;
	agent?: Toolchain["agent"];
	repoRoot?: string;
}

export interface TestContainer {
	container: Container;
	git: FakeGit;
	githubService: FakeGithubService | null;
	toolchain: Toolchain;
}

const DEFAULT_REPO_ROOT = "/repo";

/**
 * The fake-injection seam (CON-013): a real container whose adapters are the
 * in-memory fakes, injected through buildContainer's overrides — use-case
 * tests exercise exactly the wiring production runs, never module mocks.
 */
export function buildTestContainer(
	setup: TestContainerSetup = {},
): TestContainer {
	const git = new FakeGit(setup.git);
	const githubService =
		setup.github === null ? null : new FakeGithubService(setup.github ?? {});
	const toolchain: Toolchain = {
		agent: setup.agent ?? { kind: "none" },
		github: { kind: githubServiceKind(setup.github) },
	};
	const repoRoot = setup.repoRoot ?? DEFAULT_REPO_ROOT;
	const container = buildContainer({ repoRoot }, toolchain, {
		git,
		githubService,
	});
	return { container, git, githubService, toolchain };
}

function githubServiceKind(
	github: FakeGithubState | null | undefined,
): Toolchain["github"]["kind"] {
	if (github === null) {
		return "none";
	}
	return github?.kind ?? "gh";
}
