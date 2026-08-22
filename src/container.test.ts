import { describe, expect, it } from "vitest";
import { buildTestContainer } from "../test/helpers/buildTestContainer";
import { FakeGit } from "../test/helpers/FakeGit";
import { FakeGithubService } from "../test/helpers/FakeGithubService";
import type { Clock } from "./application/ports/Clock";
import { buildContainer } from "./container";
import { SystemClock } from "./infrastructure/clock/SystemClock";
import { ClaudeEngine } from "./infrastructure/engine/ClaudeEngine";
import { GitClient } from "./infrastructure/git/GitClient";
import { GhCliGithubService } from "./infrastructure/github/GhCliGithubService";
import { SessionStore } from "./infrastructure/store/SessionStore";

describe("the container shape", () => {
	it("builds the real adapters when nothing is overridden", () => {
		const { container } = buildTestContainer();
		expect(container.git).toBeInstanceOf(FakeGit);
		expect(container.githubService).toBeInstanceOf(FakeGithubService);
		expect(container.resolveChangeset).toBeTypeOf("function");
	});

	it("uses an injected fake clock as-is (CON-013)", () => {
		const fixedInstant = new Date("2026-08-21T00:00:00.000Z");
		const fakeClock: Clock = { now: () => fixedInstant };
		const container = buildContainer(
			{ repoRoot: "/repo" },
			{ agent: { kind: "none" }, github: { kind: "none" } },
			{ clock: fakeClock },
		);
		expect(container.clock.now()).toBe(fixedInstant);
	});

	it("defaults the clock to SystemClock", () => {
		const container = buildContainer(
			{ repoRoot: "/repo" },
			{ agent: { kind: "none" }, github: { kind: "none" } },
		);
		expect(container.clock).toBeInstanceOf(SystemClock);
	});
});

describe("GithubService selection by toolchain", () => {
	it('github "gh" builds a real GhCliGithubService', () => {
		const container = buildContainer(
			{ repoRoot: "/repo" },
			{ agent: { kind: "none" }, github: { kind: "gh" } },
		);
		expect(container.git).toBeInstanceOf(GitClient);
		expect(container.githubService).toBeInstanceOf(GhCliGithubService);
	});

	it('github "none" leaves githubService null', () => {
		const container = buildContainer(
			{ repoRoot: "/repo" },
			{ agent: { kind: "none" }, github: { kind: "none" } },
		);
		expect(container.githubService).toBeNull();
	});

	it("an explicit null override beats the toolchain's selection", () => {
		const container = buildContainer(
			{ repoRoot: "/repo" },
			{ agent: { kind: "none" }, github: { kind: "gh" } },
			{ githubService: null },
		);
		expect(container.githubService).toBeNull();
	});
});

describe("Engine selection by toolchain (REQ-009)", () => {
	it('agent "claude" builds a real ClaudeEngine', () => {
		const container = buildContainer(
			{ repoRoot: "/repo" },
			{
				agent: { kind: "claude", version: "2.1.239" },
				github: { kind: "none" },
			},
		);
		expect(container.engine).toBeInstanceOf(ClaudeEngine);
	});

	it('agent "none" leaves engine null — absent, not disabled', () => {
		const container = buildContainer(
			{ repoRoot: "/repo" },
			{ agent: { kind: "none" }, github: { kind: "none" } },
		);
		expect(container.engine).toBeNull();
	});

	it("an explicit null override beats the toolchain's selection", () => {
		const container = buildContainer(
			{ repoRoot: "/repo" },
			{
				agent: { kind: "claude", version: "2.1.239" },
				github: { kind: "none" },
			},
			{ engine: null },
		);
		expect(container.engine).toBeNull();
	});
});

describe("SessionStore", () => {
	it("defaults to a real SessionStore rooted under the repo's .prreview/", () => {
		const container = buildContainer(
			{ repoRoot: "/repo" },
			{ agent: { kind: "none" }, github: { kind: "none" } },
		);
		expect(container.sessionStore).toBeInstanceOf(SessionStore);
	});
});
