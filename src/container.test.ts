import { describe, expect, it } from "vitest";
import { buildTestContainer } from "../test/helpers/buildTestContainer";
import { FakeGit } from "../test/helpers/FakeGit";
import { FakeGithubService } from "../test/helpers/FakeGithubService";
import type { Clock } from "./application/ports/Clock";
import { buildContainer } from "./container";
import { SystemClock } from "./infrastructure/clock/SystemClock";
import { GitClient } from "./infrastructure/git/GitClient";
import { GhCliGithubService } from "./infrastructure/github/GhCliGithubService";

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
