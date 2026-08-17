import { join } from "node:path";
import type { Engine } from "../../src/application/ports/Engine";
import type {
	AppEvent,
	PublishEvent,
} from "../../src/application/ports/EventPublisher";
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
	/** null = the agent CLI is absent even though the toolchain claims one */
	engine?: Engine | null;
	/**
	 * A real directory for tests that actually spawn something: the engine
	 * workspace of a worktree changeset is the repo root, and a child process
	 * needs it to exist.
	 */
	repoRoot?: string;
	cacheDir?: string;
}

export interface TestContainer {
	container: Container;
	git: FakeGit;
	githubService: FakeGithubService | null;
	store: InMemorySessionStore;
	toolchain: Toolchain;
	/** every run, annotation, and chat event the container published, in order */
	events: AppEvent[];
}

const DEFAULT_REPO_ROOT = "/repo";
const DEFAULT_CACHE_DIR = "/cache/prreview";

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
	const events: AppEvent[] = [];
	const publish: PublishEvent = (event) => {
		events.push(event);
	};
	const repoRoot = setup.repoRoot ?? DEFAULT_REPO_ROOT;
	const container = buildContainer(
		{
			repoRoot,
			dataDir: join(repoRoot, ".prreview"),
			cacheDir: setup.cacheDir ?? DEFAULT_CACHE_DIR,
		},
		toolchain,
		{
			git,
			githubService,
			store,
			publish,
			...(setup.engine === undefined ? {} : { engine: setup.engine }),
		},
	);
	return { container, git, githubService, store, toolchain, events };
}

function githubServiceKind(
	github: FakeGithubState | null | undefined,
): Toolchain["github"]["kind"] {
	if (github === null) {
		return "none";
	}
	return github?.kind ?? "gh";
}
