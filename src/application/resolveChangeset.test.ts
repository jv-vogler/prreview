import { describe, expect, it } from "vitest";
import { buildTestContainer } from "../../test/helpers/buildTestContainer";
import { ChangesetError } from "../domain/errors/ChangesetError";
import { GithubError } from "../domain/errors/GithubError";
import type { PrInfo } from "./ports/GithubService";

function sha(letter: string): string {
	return letter.repeat(40);
}

function prInfo(overrides: Partial<PrInfo> = {}): PrInfo {
	return {
		title: "Add rate limiting",
		body: "Token bucket per client.",
		baseRefName: "main",
		headRefName: "feat/rate-limit",
		headRefOid: sha("e"),
		url: "https://github.com/acme/api/pull/482",
		state: "OPEN",
		...overrides,
	};
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected the promise to reject");
}

/** A gh-backed world where PR #482 exists and its head is already local. */
function ghWorld() {
	return buildTestContainer({
		git: {
			refs: {
				HEAD: sha("a"),
				"refs/remotes/origin/main": sha("c"),
				main: sha("c"),
			},
			objects: [sha("e")],
			mergeBases: { [`${sha("c")}..${sha("e")}`]: sha("d") },
		},
		github: { prs: { 482: prInfo() } },
	});
}

describe("positional disambiguation", () => {
	it("all digits resolve as a PR number in this repo", async () => {
		const { container } = ghWorld();
		const { ref } = await container.resolveChangeset({ target: "482" });
		expect(ref.source).toEqual({ kind: "pr", repo: "acme/api", number: 482 });
		expect(ref.requestedAs).toBe("482");
		expect(ref.headSha).toBe(sha("e"));
		expect(ref.baseSha).toBe(sha("d"));
	});

	it("does not fetch a PR head that is already local", async () => {
		const { container, githubService } = ghWorld();
		await container.resolveChangeset({ target: "482" });
		expect(githubService?.fetchedPrHeads).toEqual([]);
	});

	it("fetches the PR head when it is not local", async () => {
		const setup = ghWorld();
		setup.git.state.objects = [];
		const { ref } = await setup.container.resolveChangeset({ target: "482" });
		expect(setup.githubService?.fetchedPrHeads).toEqual([482]);
		expect(ref.headSha).toBe(sha("e"));
	});

	it("a GitHub PR URL resolves as that PR, repo taken from the URL", async () => {
		const { container } = ghWorld();
		const { ref } = await container.resolveChangeset({
			target: "https://github.com/acme/api/pull/482",
		});
		expect(ref.source).toEqual({ kind: "pr", repo: "acme/api", number: 482 });
	});

	it("a from..to target resolves as a range at the merge-base", async () => {
		const { container } = buildTestContainer({
			git: {
				refs: { "HEAD~3": sha("f"), HEAD: sha("a") },
				mergeBases: { [`${sha("f")}..${sha("a")}`]: sha("f") },
			},
		});
		const { ref } = await container.resolveChangeset({
			target: "HEAD~3..HEAD",
		});
		expect(ref.source).toEqual({ kind: "range", from: "HEAD~3", to: "HEAD" });
		expect(ref.baseSha).toBe(sha("f"));
		expect(ref.headSha).toBe(sha("a"));
		expect(ref.requestedAs).toBe("HEAD~3..HEAD");
	});

	it("three dots parse to the same range as two", async () => {
		const { container } = buildTestContainer({
			git: { refs: { main: sha("c"), HEAD: sha("a") } },
		});
		const { ref } = await container.resolveChangeset({ target: "main...HEAD" });
		expect(ref.source).toEqual({ kind: "range", from: "main", to: "HEAD" });
	});

	it("an empty range side defaults to HEAD, as in git", async () => {
		const { container } = buildTestContainer({
			git: { refs: { "feat-x": sha("b"), HEAD: sha("a") } },
		});
		const { ref } = await container.resolveChangeset({ target: "..feat-x" });
		expect(ref.source).toEqual({ kind: "range", from: "HEAD", to: "feat-x" });
	});

	it("an unknown range endpoint is branch-not-found without a suggestion", async () => {
		const { container } = buildTestContainer({
			git: { refs: { HEAD: sha("a") }, branches: ["main"] },
		});
		const error = await rejectionOf(
			container.resolveChangeset({ target: "HEAD..nope" }),
		);
		expect(error).toBeInstanceOf(ChangesetError);
		expect((error as ChangesetError).reason).toBe("branch-not-found");
		expect((error as ChangesetError).message).not.toContain("Did you mean");
	});

	it("the literal working resolves the worktree", async () => {
		const { container } = buildTestContainer({
			git: { refs: { HEAD: sha("a") }, fingerprint: "fp-1" },
		});
		const { ref } = await container.resolveChangeset({ target: "working" });
		expect(ref.source).toEqual({ kind: "worktree" });
		expect(ref.baseSha).toBe(sha("a"));
		expect(ref.headSha).toBeNull();
		expect(ref.worktreeFingerprint).toBe("fp-1");
	});

	it("anything else is a branch against the default branch's merge-base", async () => {
		const { container } = buildTestContainer({
			git: {
				refs: { "feat-x": sha("b"), main: sha("c"), HEAD: sha("a") },
				mergeBases: { [`${sha("c")}..${sha("b")}`]: sha("d") },
			},
		});
		const { ref } = await container.resolveChangeset({ target: "feat-x" });
		expect(ref.source).toEqual({
			kind: "branch",
			branch: "feat-x",
			base: "main",
		});
		expect(ref.baseSha).toBe(sha("d"));
		expect(ref.headSha).toBe(sha("b"));
	});

	it("an explicit base wins over the default branch", async () => {
		const { container } = buildTestContainer({
			git: { refs: { "feat-x": sha("b"), develop: sha("c") } },
		});
		const { ref } = await container.resolveChangeset({
			target: "feat-x",
			base: "develop",
		});
		expect(ref.source).toEqual({
			kind: "branch",
			branch: "feat-x",
			base: "develop",
		});
	});

	it("a missing branch answers with the nearest name (did you mean)", async () => {
		const { container } = buildTestContainer({
			git: { refs: {}, branches: ["feat/rate-limit", "main"] },
		});
		const error = await rejectionOf(
			container.resolveChangeset({ target: "feat/rate-limt" }),
		);
		expect(error).toBeInstanceOf(ChangesetError);
		expect((error as ChangesetError).reason).toBe("branch-not-found");
		expect((error as ChangesetError).message).toContain(
			'Did you mean "feat/rate-limit"?',
		);
	});

	it("a hopelessly distant name gets no suggestion", async () => {
		const { container } = buildTestContainer({
			git: { refs: {}, branches: ["main"] },
		});
		const error = await rejectionOf(
			container.resolveChangeset({ target: "zzzzzzzzzz" }),
		);
		expect((error as ChangesetError).message).not.toContain("Did you mean");
	});
});

describe("auto-detect chain", () => {
	it("a dirty tree resolves the worktree, whatever branch is checked out", async () => {
		const { container } = buildTestContainer({
			git: { dirty: true, refs: { HEAD: sha("a") }, fingerprint: "fp-1" },
		});
		const { ref, announce } = await container.resolveChangeset({});
		expect(ref.source).toEqual({ kind: "worktree" });
		expect(ref.requestedAs).toBeUndefined();
		expect(announce.resolved).toContain("working tree");
		expect(announce.overrideHint).toContain("prreview");
	});

	it("a clean tree with an open PR on the current branch resolves that PR", async () => {
		const { container } = buildTestContainer({
			git: {
				refs: { "refs/remotes/origin/main": sha("c") },
				objects: [sha("e")],
			},
			github: { prs: { 482: prInfo() }, currentBranchPr: prInfo() },
		});
		const { ref } = await container.resolveChangeset({});
		expect(ref.source).toEqual({ kind: "pr", repo: "acme/api", number: 482 });
		expect(ref.requestedAs).toBeUndefined();
	});

	it("a merged PR does not count; the chain falls through to the branch", async () => {
		const setup = buildTestContainer({
			git: {
				refs: { "feat-x": sha("b"), main: sha("c") },
				currentBranch: "feat-x",
			},
			github: { currentBranchPr: prInfo({ state: "MERGED" }) },
		});
		const { ref } = await setup.container.resolveChangeset({});
		expect(ref.source).toEqual({
			kind: "branch",
			branch: "feat-x",
			base: "main",
		});
	});

	it("without a gh backend the chain skips straight to merge-base", async () => {
		const { container } = buildTestContainer({
			git: {
				refs: { "feat-x": sha("b"), main: sha("c") },
				currentBranch: "feat-x",
			},
			github: null,
		});
		const { ref, announce } = await container.resolveChangeset({});
		expect(ref.source).toEqual({
			kind: "branch",
			branch: "feat-x",
			base: "main",
		});
		expect(announce.resolved).toContain("auto-detected");
	});

	it("clean tree on the default branch with no PR is a usage error", async () => {
		const { container } = buildTestContainer({
			git: { currentBranch: "main" },
			github: null,
		});
		const error = await rejectionOf(container.resolveChangeset({}));
		expect(error).toBeInstanceOf(ChangesetError);
		expect((error as ChangesetError).reason).toBe("cannot-auto-detect");
		expect((error as ChangesetError).message).toContain("prreview");
	});

	it("a detached HEAD cannot be auto-detected", async () => {
		const { container } = buildTestContainer({
			git: { currentBranch: null },
			github: null,
		});
		const error = await rejectionOf(container.resolveChangeset({}));
		expect((error as ChangesetError).reason).toBe("cannot-auto-detect");
	});
});

describe("PR resolution across backends", () => {
	it("an explicit PR with no GitHub backend at all is unsupported", async () => {
		const { container } = buildTestContainer({ github: null });
		const error = await rejectionOf(
			container.resolveChangeset({ target: "482" }),
		);
		expect(error).toBeInstanceOf(GithubError);
		expect((error as GithubError).reason).toBe("unsupported-backend");
	});

	it("a PR the backend does not know converts to pr-not-found", async () => {
		const { container } = buildTestContainer({
			git: { remotes: { origin: "git@github.com:acme/api.git" } },
			github: { prs: {} },
		});
		const error = await rejectionOf(
			container.resolveChangeset({ target: "9999" }),
		);
		expect(error).toBeInstanceOf(ChangesetError);
		expect((error as ChangesetError).reason).toBe("pr-not-found");
	});

	it("the git-remote backend resolves a PR by fetching, based on the default branch", async () => {
		const setup = buildTestContainer({
			git: {
				refs: { "refs/remotes/origin/main": sha("c") },
				remotes: { origin: "git@github.com:acme/api.git" },
				mergeBases: { [`${sha("c")}..${sha("e")}`]: sha("d") },
			},
			github: { kind: "git-remote", prHeads: { 482: sha("e") } },
		});
		const { ref } = await setup.container.resolveChangeset({ target: "482" });
		expect(ref.source).toEqual({ kind: "pr", repo: "acme/api", number: 482 });
		expect(ref.headSha).toBe(sha("e"));
		expect(ref.baseSha).toBe(sha("d"));
		expect(setup.githubService?.fetchedPrHeads).toEqual([482]);
	});

	it("an https remote URL also yields the repo slug", async () => {
		const setup = buildTestContainer({
			git: {
				refs: { "refs/remotes/origin/main": sha("c") },
				remotes: { origin: "https://github.com/acme/api.git" },
			},
			github: { kind: "git-remote", prHeads: { 482: sha("e") } },
		});
		const { ref } = await setup.container.resolveChangeset({ target: "482" });
		expect(ref.source).toEqual({ kind: "pr", repo: "acme/api", number: 482 });
	});
});

describe("the announcement", () => {
	it("states what was resolved and the explicit override form", async () => {
		const { container } = ghWorld();
		const { announce } = await container.resolveChangeset({ target: "482" });
		expect(announce.resolved).toContain("pull request #482 of acme/api");
		expect(announce.overrideHint).toContain("prreview <branch> [base]");
	});
});
