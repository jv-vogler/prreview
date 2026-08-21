import { readFile, realpath, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import gitDiffParser from "gitdiff-parser";
import { afterAll, describe, expect, it } from "vitest";
import {
	createFixtureRepo,
	type FixtureRepo,
} from "../../../test/helpers/createFixtureRepo";
import { parseDiff } from "../../domain/changeset/parseDiff";
import { GitClient } from "./GitClient";

const disposables: FixtureRepo[] = [];

async function fixtureRepo(
	options?: Parameters<typeof createFixtureRepo>[0],
): Promise<FixtureRepo> {
	const repo = await createFixtureRepo(options);
	disposables.push(repo);
	return repo;
}

async function trackClone(origin: FixtureRepo): Promise<FixtureRepo> {
	const cloned = await origin.clone();
	disposables.push(cloned);
	return cloned;
}

afterAll(async () => {
	await Promise.all(disposables.map((repo) => repo.dispose()));
});

describe("repo discovery", () => {
	it("repoRoot resolves the toplevel from a subdirectory", async () => {
		const repo = await fixtureRepo();
		await repo.write("nested/deep/file.txt", "content\n");
		const client = new GitClient(join(repo.root, "nested/deep"));
		expect(await client.repoRoot()).toBe(await realpath(repo.root));
	});

	it("gitCommonDir is the absolute .git directory", async () => {
		const repo = await fixtureRepo();
		const client = new GitClient(repo.root);
		expect(await client.gitCommonDir()).toBe(
			join(await realpath(repo.root), ".git"),
		);
	});
});

describe("verifyRef", () => {
	it("resolves a branch name to its commit sha", async () => {
		const repo = await fixtureRepo();
		const client = new GitClient(repo.root);
		expect(await client.verifyRef("main")).toBe(await repo.headSha());
	});

	it("throws raw when the ref does not exist", async () => {
		const repo = await fixtureRepo();
		const client = new GitClient(repo.root);
		await expect(client.verifyRef("no-such-branch")).rejects.toThrow();
	});

	/*
		The one that only a real git can fail. `rev-parse --verify` handed a
		full 40-hex string echoes it back without looking for the object, so
		every fake that models the documented contract passes while the adapter
		says "present" about a commit this repo has never seen. That answer is
		what stopped a PR head from being fetched once its branch was deleted.
	*/
	it("rejects a full-length sha this repo does not have", async () => {
		const repo = await fixtureRepo();
		const client = new GitClient(repo.root);
		await expect(client.verifyRef("d".repeat(40))).rejects.toThrow();
	});

	it("resolves a full-length sha this repo does have", async () => {
		const repo = await fixtureRepo();
		const client = new GitClient(repo.root);
		const head = await repo.headSha();
		expect(await client.verifyRef(head)).toBe(head);
	});
});

describe("remoteUrl", () => {
	it("returns the origin url of a clone", async () => {
		const origin = await fixtureRepo();
		const cloned = await trackClone(origin);
		const client = new GitClient(cloned.root);
		expect(await client.remoteUrl("origin")).toBe(origin.root);
	});

	it("throws raw when the remote does not exist", async () => {
		const repo = await fixtureRepo();
		const client = new GitClient(repo.root);
		await expect(client.remoteUrl("origin")).rejects.toThrow();
	});
});

describe("defaultBranch", () => {
	it("reads origin/HEAD in a clone", async () => {
		const origin = await fixtureRepo();
		const cloned = await trackClone(origin);
		expect(await new GitClient(cloned.root).defaultBranch()).toBe("main");
	});

	it("falls back to probing main when origin/HEAD is unset", async () => {
		const repo = await fixtureRepo();
		expect(await new GitClient(repo.root).defaultBranch()).toBe("main");
	});

	it("falls back to master when there is no main", async () => {
		const repo = await fixtureRepo({ defaultBranch: "master" });
		expect(await new GitClient(repo.root).defaultBranch()).toBe("master");
	});

	it("throws raw when nothing resolves", async () => {
		const repo = await fixtureRepo({ defaultBranch: "trunk" });
		await expect(new GitClient(repo.root).defaultBranch()).rejects.toThrow(
			"default branch",
		);
	});
});

describe("mergeBase", () => {
	it("finds the fork point of two diverged branches", async () => {
		const repo = await fixtureRepo();
		const forkSha = await repo.headSha();
		await repo.git(["checkout", "--quiet", "-b", "feature"]);
		await repo.write("feature.txt", "feature work\n");
		await repo.commitAll("feature commit");
		await repo.git(["checkout", "--quiet", "main"]);
		await repo.write("mainline.txt", "main moved on\n");
		await repo.commitAll("main commit");

		const client = new GitClient(repo.root);
		expect(await client.mergeBase("main", "feature")).toBe(forkSha);
	});
});

describe("diff", () => {
	it("produces canonical parseable diff text between two commits", async () => {
		const repo = await fixtureRepo();
		await repo.write("app.ts", "const value = 1;\n");
		const base = await repo.commitAll("add app");
		await repo.write("app.ts", "const value = 2;\n");
		const head = await repo.commitAll("bump value");

		const diffText = await new GitClient(repo.root).diff(base, head);
		expect(diffText).toContain("diff --git a/app.ts b/app.ts");

		const [file] = parseDiff(gitDiffParser.parse(diffText));
		expect(file.path).toBe("app.ts");
		expect(file.status).toBe("modified");
		expect(file.additions).toBe(1);
		expect(file.deletions).toBe(1);
	});

	it("detects renames with edits (-M)", async () => {
		const repo = await fixtureRepo();
		const originalBody = `${"stable line\n".repeat(20)}const value = 1;\n`;
		await repo.write("before.ts", originalBody);
		const base = await repo.commitAll("add before");
		await repo.remove("before.ts");
		await repo.write("after.ts", originalBody.replace("= 1", "= 2"));
		const head = await repo.commitAll("rename with edit");

		const diffText = await new GitClient(repo.root).diff(base, head);
		expect(diffText).toContain("rename from before.ts");

		const [file] = parseDiff(gitDiffParser.parse(diffText));
		expect(file.status).toBe("renamed");
		expect(file.oldPath).toBe("before.ts");
		expect(file.path).toBe("after.ts");
	});

	it("reports binary changes", async () => {
		const repo = await fixtureRepo();
		await repo.write("blob.bin", Buffer.from([0, 1, 2, 3, 0, 255]));
		const base = await repo.commitAll("add binary");
		await repo.write("blob.bin", Buffer.from([0, 9, 9, 9, 0, 254]));
		const head = await repo.commitAll("change binary");

		const diffText = await new GitClient(repo.root).diff(base, head);
		const [file] = parseDiff(gitDiffParser.parse(diffText));
		expect(file.isBinary).toBe(true);
		expect(file.hunks).toHaveLength(0);
	});
});

describe("diffWorktree", () => {
	it("combines staged and unstaged edits versus HEAD", async () => {
		const repo = await fixtureRepo();
		await repo.write("staged.txt", "original staged\n");
		await repo.write("unstaged.txt", "original unstaged\n");
		await repo.commitAll("two files");

		await repo.write("staged.txt", "edited and staged\n");
		await repo.git(["add", "staged.txt"]);
		await repo.write("unstaged.txt", "edited, left unstaged\n");
		await repo.write("untracked.txt", "brand new\n");

		const diffText = await new GitClient(repo.root).diffWorktree();
		const files = parseDiff(gitDiffParser.parse(diffText));
		const paths = files.map((file) => file.path).sort();
		expect(paths).toEqual(["staged.txt", "unstaged.txt"]);
	});

	it("is empty in a clean worktree", async () => {
		const repo = await fixtureRepo();
		expect(await new GitClient(repo.root).diffWorktree()).toBe("");
	});
});

describe("blob reads", () => {
	it("readBlob returns committed content at ref:path, byte-exact for binary", async () => {
		const repo = await fixtureRepo();
		const bytes = Buffer.from([0, 1, 2, 250, 0, 13, 10]);
		await repo.write("blob.bin", bytes);
		await repo.write("note.txt", "committed text\n");
		await repo.commitAll("content");

		const client = new GitClient(repo.root);
		expect((await client.readBlob("HEAD", "note.txt")).toString()).toBe(
			"committed text\n",
		);
		expect((await client.readBlob("HEAD", "blob.bin")).equals(bytes)).toBe(
			true,
		);
	});

	it("readIndexBlob returns the staged content, not the worktree's", async () => {
		const repo = await fixtureRepo();
		await repo.write("file.txt", "v1\n");
		await repo.commitAll("v1");
		await repo.write("file.txt", "v2 staged\n");
		await repo.git(["add", "file.txt"]);
		await repo.write("file.txt", "v3 only in worktree\n");

		const client = new GitClient(repo.root);
		expect((await client.readIndexBlob("file.txt")).toString()).toBe(
			"v2 staged\n",
		);
	});

	it("readBlob throws raw for a path outside the changeset", async () => {
		const repo = await fixtureRepo();
		const client = new GitClient(repo.root);
		await expect(client.readBlob("HEAD", "missing.txt")).rejects.toThrow();
	});

	it("readObject returns the blob bytes for an object id", async () => {
		const repo = await fixtureRepo();
		const bytes = Buffer.from([0, 1, 2, 250, 0]);
		await repo.write("blob.bin", bytes);
		await repo.write("note.txt", "by oid\n");
		await repo.commitAll("content");

		const client = new GitClient(repo.root);
		const textOid = (await repo.git(["rev-parse", "HEAD:note.txt"])).trim();
		const binaryOid = (await repo.git(["rev-parse", "HEAD:blob.bin"])).trim();
		expect((await client.readObject(textOid)).toString()).toBe("by oid\n");
		expect((await client.readObject(binaryOid)).equals(bytes)).toBe(true);
	});

	it("readObject rejects anything that is not an object id before it reaches argv (SEC-002)", async () => {
		const repo = await fixtureRepo();
		const client = new GitClient(repo.root);
		for (const notAnOid of [
			"HEAD:../../etc/passwd",
			"HEAD",
			"main",
			"--help",
			"",
			"ZZZZ".repeat(10),
		]) {
			await expect(client.readObject(notAnOid)).rejects.toThrow(
				/not an object id/,
			);
		}
	});

	it("readWorkingFile returns the tree's current bytes", async () => {
		const repo = await fixtureRepo();
		await repo.write("nested/file.txt", "working copy\n");
		expect(
			(
				await new GitClient(repo.root).readWorkingFile("nested/file.txt")
			).toString(),
		).toBe("working copy\n");
	});

	it("readWorkingFile refuses a path escaping the repo root (SEC-002)", async () => {
		const repo = await fixtureRepo();
		const client = new GitClient(repo.root);
		await expect(client.readWorkingFile("../outside.txt")).rejects.toThrow();
	});
});

describe("worktree management", () => {
	it("adds a detached checkout outside the repo, then removes it", async () => {
		const repo = await fixtureRepo();
		await repo.write("file.txt", "first\n");
		const firstSha = await repo.commitAll("first");
		await repo.write("file.txt", "second\n");
		await repo.commitAll("second");

		const client = new GitClient(repo.root);
		const dir = join(await realpath(tmpdir()), `prreview-wt-${Date.now()}`);
		await client.addWorktree(dir, firstSha);

		expect(await readFile(join(dir, "file.txt"), "utf8")).toBe("first\n");
		// detached: the user's branch set is untouched
		expect(await client.localBranches()).toEqual(["main"]);

		await client.removeWorktree(dir);
		await expect(stat(dir)).rejects.toThrow();
	});

	it("prune succeeds on a repo with no worktrees at all", async () => {
		const repo = await fixtureRepo();
		await expect(
			new GitClient(repo.root).pruneWorktrees(),
		).resolves.toBeUndefined();
	});
});

describe("hashObject", () => {
	it("matches the oid git recorded for the committed file", async () => {
		const repo = await fixtureRepo();
		await repo.write("file.txt", "hash me\n");
		await repo.commitAll("add file");

		const client = new GitClient(repo.root);
		const recorded = (await repo.git(["rev-parse", "HEAD:file.txt"])).trim();
		expect(await client.hashObject("file.txt")).toBe(recorded);
	});
});

describe("worktreeFingerprint", () => {
	it("is stable while nothing changes, including mtime-only touches", async () => {
		const repo = await fixtureRepo();
		await repo.write("file.txt", "content\n");
		await repo.commitAll("add file");
		const client = new GitClient(repo.root);

		const first = await client.worktreeFingerprint();
		expect(await client.worktreeFingerprint()).toBe(first);

		const touchedAt = new Date();
		await utimes(join(repo.root, "file.txt"), touchedAt, touchedAt);
		expect(await client.worktreeFingerprint()).toBe(first);
	});

	it("changes on edit and returns to the original after a revert", async () => {
		const repo = await fixtureRepo();
		await repo.write("file.txt", "original\n");
		await repo.commitAll("add file");
		const client = new GitClient(repo.root);

		const clean = await client.worktreeFingerprint();
		await repo.write("file.txt", "edited\n");
		const dirty = await client.worktreeFingerprint();
		expect(dirty).not.toBe(clean);

		await repo.write("file.txt", "original\n");
		expect(await client.worktreeFingerprint()).toBe(clean);
	});

	it("changes when an edit is staged (index state participates)", async () => {
		const repo = await fixtureRepo();
		await repo.write("file.txt", "original\n");
		await repo.commitAll("add file");
		const client = new GitClient(repo.root);

		await repo.write("file.txt", "edited\n");
		const unstaged = await client.worktreeFingerprint();
		await repo.git(["add", "file.txt"]);
		expect(await client.worktreeFingerprint()).not.toBe(unstaged);
	});

	it("changes when an untracked file appears, even inside a new directory", async () => {
		const repo = await fixtureRepo();
		const client = new GitClient(repo.root);
		const before = await client.worktreeFingerprint();

		await repo.write("brand/new/file.txt", "untracked\n");
		expect(await client.worktreeFingerprint()).not.toBe(before);
	});

	it("handles a deleted tracked file", async () => {
		const repo = await fixtureRepo();
		await repo.write("doomed.txt", "short-lived\n");
		await repo.commitAll("add doomed");
		const client = new GitClient(repo.root);

		const before = await client.worktreeFingerprint();
		await repo.remove("doomed.txt");
		expect(await client.worktreeFingerprint()).not.toBe(before);
	});
});

describe("fetchPrHead", () => {
	it("fetches refs/pull/N/head from origin into a named local ref", async () => {
		const origin = await fixtureRepo();
		await origin.git(["checkout", "--quiet", "-b", "feature"]);
		await origin.write("feature.txt", "pr content\n");
		const prHeadSha = await origin.commitAll("pr commit");
		await origin.git(["update-ref", "refs/pull/7/head", prHeadSha]);
		await origin.git(["checkout", "--quiet", "main"]);

		const cloned = await trackClone(origin);
		const client = new GitClient(cloned.root);

		expect(await client.fetchPrHead(7)).toBe(prHeadSha);
		expect(await client.verifyRef("refs/prreview/pr/7")).toBe(prHeadSha);
	});

	it("throws raw when the pull ref does not exist on origin", async () => {
		const origin = await fixtureRepo();
		const cloned = await trackClone(origin);
		await expect(new GitClient(cloned.root).fetchPrHead(99)).rejects.toThrow();
	});
});

describe("currentBranch", () => {
	it("names the checked-out branch", async () => {
		const repo = await fixtureRepo();
		expect(await new GitClient(repo.root).currentBranch()).toBe("main");
	});

	it("is null on a detached HEAD", async () => {
		const repo = await fixtureRepo();
		await repo.git(["checkout", "--quiet", "--detach", "HEAD"]);
		expect(await new GitClient(repo.root).currentBranch()).toBeNull();
	});
});

describe("localBranches", () => {
	it("lists every local branch name", async () => {
		const repo = await fixtureRepo();
		await repo.git(["branch", "feat/rate-limit"]);
		await repo.git(["branch", "fix-typo"]);
		expect((await new GitClient(repo.root).localBranches()).sort()).toEqual([
			"feat/rate-limit",
			"fix-typo",
			"main",
		]);
	});
});

describe("isDirty", () => {
	it("is false on a clean checkout", async () => {
		const repo = await fixtureRepo();
		expect(await new GitClient(repo.root).isDirty()).toBe(false);
	});

	it("sees unstaged and staged tracked changes", async () => {
		const repo = await fixtureRepo();
		const client = new GitClient(repo.root);

		await repo.write("README.md", "# edited\n");
		expect(await client.isDirty()).toBe(true);

		await repo.git(["add", "-A"]);
		expect(await client.isDirty()).toBe(true);
	});

	it("does not count untracked files (they cannot appear in diffWorktree)", async () => {
		const repo = await fixtureRepo();
		await repo.write("brand-new.txt", "untracked\n");
		expect(await new GitClient(repo.root).isDirty()).toBe(false);
	});
});
