import type { Engine } from "../../src/application/ports/Engine";
import type { SessionStore } from "../../src/application/ports/SessionStore";
import { buildContainer, type Container } from "../../src/container";
import type { Toolchain } from "../../src/domain/session/Toolchain";
import { FakeEngine } from "./FakeEngine";
import { FakeGit, type FakeGitState } from "./FakeGit";
import { FakeGithubService, type FakeGithubState } from "./FakeGithubService";
import { FakeSessionStore } from "./FakeSessionStore";

export interface TestContainerSetup {
	git?: FakeGitState;
	github?: FakeGithubState | null;
	agent?: Toolchain["agent"];
	engine?: Engine | null;
	sessionStore?: SessionStore;
	repoRoot?: string;
}

export interface TestContainer {
	container: Container;
	git: FakeGit;
	githubService: FakeGithubService | null;
	engine: Engine | null;
	toolchain: Toolchain;
}

const DEFAULT_REPO_ROOT = "/repo";

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
	const engine: Engine | null =
		setup.engine !== undefined
			? setup.engine
			: toolchain.agent.kind === "claude"
				? new FakeEngine()
				: null;
	const sessionStore = setup.sessionStore ?? new FakeSessionStore();
	const repoRoot = setup.repoRoot ?? DEFAULT_REPO_ROOT;
	const container = buildContainer({ repoRoot }, toolchain, {
		git,
		githubService,
		engine,
		sessionStore,
	});
	return { container, git, githubService, engine, toolchain };
}

function githubServiceKind(
	github: FakeGithubState | null | undefined,
): Toolchain["github"]["kind"] {
	if (github === null) {
		return "none";
	}
	return github?.kind ?? "gh";
}
