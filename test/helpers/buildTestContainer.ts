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
	/** null = no GitHub backend at all (toolchain github kind "none") */
	github?: FakeGithubState | null;
	agent?: Toolchain["agent"];
	/** null = no engine at all, even with an agent toolchain (REQ-009's absence) */
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

/**
 * The fake-injection seam (CON-013): a real container whose adapters are the
 * in-memory fakes, injected through buildContainer's overrides — use-case
 * tests exercise exactly the wiring production runs, never module mocks.
 *
 * `engine` defaults to a `FakeEngine` whenever the toolchain names an agent,
 * never to the real `ClaudeEngine`: a test never spawns a real child process
 * just because it asked for an agent toolchain.
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
