import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	createFixtureRepo,
	type FixtureRepo,
} from "../../../test/helpers/createFixtureRepo";
import { GitClient } from "../git/GitClient";
import {
	createEngineWorkspaces,
	defaultEngineCacheDir,
	worktreeDirFor,
} from "./workspace";

const disposables: (() => Promise<unknown>)[] = [];

afterAll(async () => {
	for (const dispose of disposables) {
		await dispose();
	}
});

async function scratchCacheDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "prreview-cache-"));
	disposables.push(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

/** two commits, so the reviewed head can differ from the repo's HEAD */
async function repoWithHistory(): Promise<{
	repo: FixtureRepo;
	firstSha: string;
	headSha: string;
}> {
	const repo = await createFixtureRepo();
	disposables.push(() => repo.dispose());
	await repo.write("src/main.ts", "export const one = 1;\n");
	const firstSha = await repo.commitAll("first");
	await repo.write("src/main.ts", "export const two = 2;\n");
	const headSha = await repo.commitAll("second");
	return { repo, firstSha, headSha };
}

function workspacesFor(repo: FixtureRepo, cacheDir: string) {
	return createEngineWorkspaces({
		git: new GitClient(repo.root),
		repoRoot: repo.root,
		cacheDir,
	});
}

describe("createEngineWorkspaces", () => {
	it("uses the repo itself for a worktree changeset (REQ-005)", async () => {
		const { repo } = await repoWithHistory();
		const workspaces = workspacesFor(repo, await scratchCacheDir());
		expect(
			await workspaces.ensure({ source: { kind: "worktree" }, headSha: null }),
		).toEqual({ dir: repo.root, kind: "repo" });
	});

	it("uses the repo itself when the reviewed head is the current HEAD", async () => {
		const { repo, headSha } = await repoWithHistory();
		const workspaces = workspacesFor(repo, await scratchCacheDir());
		expect(
			await workspaces.ensure({
				source: { kind: "branch", branch: "main", base: "main" },
				headSha,
			}),
		).toEqual({ dir: repo.root, kind: "repo" });
	});

	it("materializes a detached worktree holding the reviewed revision", async () => {
		const { repo, firstSha } = await repoWithHistory();
		const cacheDir = await scratchCacheDir();
		const workspaces = workspacesFor(repo, cacheDir);

		const workspace = await workspaces.ensure({
			source: { kind: "range", from: "HEAD~1", to: firstSha },
			headSha: firstSha,
		});

		expect(workspace.kind).toBe("worktree");
		expect(workspace.dir).toBe(worktreeDirFor(cacheDir, repo.root, firstSha));
		// the code in it is the reviewed revision, not the repo's HEAD
		expect(await readFile(join(workspace.dir, "src/main.ts"), "utf8")).toBe(
			"export const one = 1;\n",
		);
		// and it lives outside the repo (§11)
		expect(workspace.dir.startsWith(repo.root)).toBe(false);
	});

	it("reuses an existing valid worktree instead of re-adding it", async () => {
		const { repo, firstSha } = await repoWithHistory();
		const cacheDir = await scratchCacheDir();
		const workspaces = workspacesFor(repo, cacheDir);
		const request = {
			source: { kind: "range", from: "HEAD~1", to: firstSha } as const,
			headSha: firstSha,
		};

		const first = await workspaces.ensure(request);
		// a second `git worktree add` at the same path would fail outright, so
		// a green second call is the reuse proof
		const second = await workspaces.ensure(request);
		expect(second).toEqual(first);
	});

	it("rebuilds a leftover directory that is not a worktree", async () => {
		const { repo, firstSha } = await repoWithHistory();
		const cacheDir = await scratchCacheDir();
		const workspaces = workspacesFor(repo, cacheDir);
		const request = {
			source: { kind: "range", from: "HEAD~1", to: firstSha } as const,
			headSha: firstSha,
		};

		const workspace = await workspaces.ensure(request);
		await rm(join(workspace.dir, ".git"), { recursive: true, force: true });
		await workspaces.prune();

		const rebuilt = await workspaces.ensure(request);
		expect(rebuilt.dir).toBe(workspace.dir);
		expect(await readFile(join(rebuilt.dir, "src/main.ts"), "utf8")).toBe(
			"export const one = 1;\n",
		);
	});

	it("removes the worktrees it created on release, leaving the repo alone", async () => {
		const { repo, firstSha } = await repoWithHistory();
		const cacheDir = await scratchCacheDir();
		const workspaces = workspacesFor(repo, cacheDir);

		const workspace = await workspaces.ensure({
			source: { kind: "range", from: "HEAD~1", to: firstSha },
			headSha: firstSha,
		});
		await workspaces.release();

		await expect(stat(workspace.dir)).rejects.toThrow();
		expect((await stat(repo.root)).isDirectory()).toBe(true);
		expect(await new GitClient(repo.root).currentBranch()).toBe("main");
	});

	it("release is safe when nothing was created", async () => {
		const { repo } = await repoWithHistory();
		const workspaces = workspacesFor(repo, await scratchCacheDir());
		await expect(workspaces.release()).resolves.toBeUndefined();
	});
});

describe("worktreeDirFor", () => {
	it("separates repos by a short hash of their root and commits by sha", () => {
		const sha = "b".repeat(40);
		const one = worktreeDirFor("/cache", "/repos/one", sha);
		const two = worktreeDirFor("/cache", "/repos/two", sha);
		expect(one).not.toBe(two);
		expect(one.startsWith("/cache/worktrees/")).toBe(true);
		expect(one.endsWith(`/${sha}`)).toBe(true);
		// stable across calls, so reuse can be decided from the path alone
		expect(worktreeDirFor("/cache", "/repos/one", sha)).toBe(one);
	});
});

describe("defaultEngineCacheDir", () => {
	it("prefers XDG_CACHE_HOME", () => {
		expect(defaultEngineCacheDir({ XDG_CACHE_HOME: "/xdg" })).toBe(
			"/xdg/prreview",
		);
	});

	it("falls back to ~/.cache when XDG_CACHE_HOME is unset or empty", () => {
		expect(defaultEngineCacheDir({})).toMatch(/\.cache\/prreview$/);
		expect(defaultEngineCacheDir({ XDG_CACHE_HOME: "" })).toMatch(
			/\.cache\/prreview$/,
		);
	});
});
