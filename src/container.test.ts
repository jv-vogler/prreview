import { describe, expect, it } from "vitest";
import { FakeGit } from "../test/helpers/FakeGit";
import { InMemorySessionStore } from "../test/helpers/InMemorySessionStore";
import type { Engine, EngineEvent } from "./application/ports/Engine";
import type { RunManager } from "./application/ports/RunManager";
import { type BootConfig, buildContainer } from "./container";
import type { Toolchain } from "./domain/session/Toolchain";
import { ClaudeEngine } from "./infrastructure/engine/ClaudeEngine";
import { GitClient } from "./infrastructure/git/GitClient";
import { GhCliGithubService } from "./infrastructure/github/GhCliGithubService";
import { GitRemoteGithubService } from "./infrastructure/github/GitRemoteGithubService";
import { SessionStore as OnDiskSessionStore } from "./infrastructure/store/SessionStore";

const config: BootConfig = {
	repoRoot: "/repo",
	dataDir: "/repo/.prreview",
	cacheDir: "/cache/prreview",
};

function toolchainWith(github: Toolchain["github"]): Toolchain {
	return { agent: { kind: "none" }, github };
}

function toolchainWithAgent(agent: Toolchain["agent"]): Toolchain {
	return { agent, github: { kind: "none" } };
}

/** an Engine's iterables are never consumed in these wiring tests */
async function* emptyEvents(): AsyncGenerator<EngineEvent> {}

describe("GithubService selection by toolchain (ARCHITECTURE §4)", () => {
	it("gh → GhCliGithubService", () => {
		const container = buildContainer(config, toolchainWith({ kind: "gh" }));
		expect(container.githubService).toBeInstanceOf(GhCliGithubService);
	});

	it("git-remote → GitRemoteGithubService", () => {
		const container = buildContainer(
			config,
			toolchainWith({ kind: "git-remote" }),
		);
		expect(container.githubService).toBeInstanceOf(GitRemoteGithubService);
	});

	it("none → null (GitHub-dependent features are off)", () => {
		const container = buildContainer(config, toolchainWith({ kind: "none" }));
		expect(container.githubService).toBeNull();
	});
});

describe("Engine selection by toolchain (REQ-004, F12)", () => {
	it("claude → ClaudeEngine", () => {
		const container = buildContainer(
			config,
			toolchainWithAgent({ kind: "claude", version: "2.1.233" }),
		);
		expect(container.engine).toBeInstanceOf(ClaudeEngine);
	});

	it("none → null (every AI surface is off, the viewer is untouched)", () => {
		const container = buildContainer(
			config,
			toolchainWithAgent({ kind: "none" }),
		);
		expect(container.engine).toBeNull();
	});

	it("types as Engine | null, not null, so consumers can use it (RISK-011)", () => {
		const container = buildContainer(
			config,
			toolchainWithAgent({ kind: "none" }),
		);
		// a compile-time assertion: this line stops compiling if `engine`
		// narrows back to `null`
		const engine: Engine | null = container.engine;
		expect(engine).toBeNull();
	});

	it("an explicit null override beats the toolchain's selection", () => {
		const container = buildContainer(
			config,
			toolchainWithAgent({ kind: "claude", version: "2.1.233" }),
			{ engine: null },
		);
		expect(container.engine).toBeNull();
	});

	it("an injected engine is used as-is (PAT-001)", () => {
		const injected: Engine = {
			probe: async () => ({ kind: "claude", version: "fake" }),
			runTask: () => emptyEvents(),
			chatTurn: () => emptyEvents(),
			stop: async () => {},
		};
		const container = buildContainer(
			config,
			toolchainWithAgent({ kind: "none" }),
			{ engine: injected },
		);
		expect(container.engine).toBe(injected);
	});
});

describe("the container shape (ARCHITECTURE §2)", () => {
	it("builds the real adapters and wires every use-case", () => {
		const container = buildContainer(config, toolchainWith({ kind: "none" }));
		expect(container.git).toBeInstanceOf(GitClient);
		expect(container.store).toBeInstanceOf(OnDiskSessionStore);
		expect(container.engine).toBeNull();
		expect(container.engineWorkspaces.ensure).toBeTypeOf("function");
		expect(container.runManager.enqueue).toBeTypeOf("function");
		expect(container.openReview).toBeTypeOf("function");
		expect(container.resolveChangeset).toBeTypeOf("function");
		expect(container.refreshChangeset).toBeTypeOf("function");
		expect(container.updateCoverage).toBeTypeOf("function");
		expect(container.detectDrift).toBeTypeOf("function");
		expect(container.runAnalysis).toBeTypeOf("function");
		expect(container.chatTurn).toBeTypeOf("function");
		expect(container.updateWalkthroughProgress).toBeTypeOf("function");
	});

	it("drops published events when no interface layer supplied a sink", () => {
		const container = buildContainer(config, toolchainWith({ kind: "none" }));
		expect(() =>
			container.publish({ type: "annotation.removed", id: "01X" }),
		).not.toThrow();
	});

	it("routes run-manager events to the injected publisher", () => {
		const events: string[] = [];
		const container = buildContainer(config, toolchainWith({ kind: "none" }), {
			publish: (event) => events.push(event.type),
		});
		container.runManager.enqueue({
			lane: "analysis",
			taskType: "comprehension",
			job: async () => ({ ok: true }),
		});
		expect(events).toContain("run.queued");
	});

	it("an injected run manager is used as-is (PAT-001)", () => {
		const runManager: RunManager = {
			enqueue: () => ({ kind: "accepted", runId: "run-1" }),
			cancel: () => false,
			cancelAll: () => {},
			get: () => undefined,
			list: () => [],
		};
		const container = buildContainer(config, toolchainWith({ kind: "none" }), {
			runManager,
		});
		expect(container.runManager).toBe(runManager);
	});

	it("overrides inject fakes at the composition root (PAT-001)", () => {
		const git = new FakeGit();
		const store = new InMemorySessionStore();
		const container = buildContainer(config, toolchainWith({ kind: "gh" }), {
			git,
			githubService: null,
			store,
		});
		expect(container.git).toBe(git);
		expect(container.store).toBe(store);
		// an explicit null override beats the toolchain's selection
		expect(container.githubService).toBeNull();
	});
});
