import { describe, expect, it } from "vitest";
import { FakeGit } from "../test/helpers/FakeGit";
import { InMemorySessionStore } from "../test/helpers/InMemorySessionStore";
import { type BootConfig, buildContainer } from "./container";
import type { Toolchain } from "./domain/session/Toolchain";
import { GitClient } from "./infrastructure/git/GitClient";
import { GhCliGithubService } from "./infrastructure/github/GhCliGithubService";
import { GitRemoteGithubService } from "./infrastructure/github/GitRemoteGithubService";
import { SessionStore as OnDiskSessionStore } from "./infrastructure/store/SessionStore";

const config: BootConfig = {
	repoRoot: "/repo",
	dataDir: "/repo/.prreview",
};

function toolchainWith(github: Toolchain["github"]): Toolchain {
	return { agent: { kind: "none" }, github };
}

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

describe("the container shape (ARCHITECTURE §2)", () => {
	it("builds the real adapters and wires every use-case", () => {
		const container = buildContainer(config, toolchainWith({ kind: "none" }));
		expect(container.git).toBeInstanceOf(GitClient);
		expect(container.store).toBeInstanceOf(OnDiskSessionStore);
		expect(container.engine).toBeNull();
		expect(container.openReview).toBeTypeOf("function");
		expect(container.resolveChangeset).toBeTypeOf("function");
		expect(container.refreshChangeset).toBeTypeOf("function");
		expect(container.updateCoverage).toBeTypeOf("function");
		expect(container.detectDrift).toBeTypeOf("function");
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
