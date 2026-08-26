import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { exec, execBuffer } from "./exec";

const DIFF_SAFE_CONFIG = [
	"-c",
	"core.quotepath=false",
	"-c",
	"diff.noprefix=false",
	"-c",
	"diff.mnemonicPrefix=false",
];

const DIFF_FLAGS = [
	"-M",
	"-C",
	"--unified=3",
	"--no-color",
	"--no-ext-diff",
	"--no-textconv",

	"--full-index",
];

const DEFAULT_BRANCH_CANDIDATES = ["main", "master"];

const REPO_FROM_CWD_ONLY: Record<string, string | undefined> = {
	GIT_DIR: undefined,
	GIT_WORK_TREE: undefined,
	GIT_INDEX_FILE: undefined,
	GIT_PREFIX: undefined,
	GIT_TERMINAL_PROMPT: "0",
};

const OBJECT_ID = /^[0-9a-f]{7,64}$/;

export class GitClient {
	private readonly cwd: string;

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	async repoRoot(): Promise<string> {
		return (await this.git(["rev-parse", "--show-toplevel"])).trim();
	}

	async gitCommonDir(): Promise<string> {
		return (
			await this.git([
				"rev-parse",
				"--path-format=absolute",
				"--git-common-dir",
			])
		).trim();
	}

	async verifyRef(ref: string): Promise<string> {
		return (
			await this.git([
				"rev-parse",
				"--verify",
				"--end-of-options",
				`${ref}^{commit}`,
			])
		).trim();
	}

	async defaultBranch(): Promise<string> {
		try {
			const originHead = (
				await this.git(["symbolic-ref", "refs/remotes/origin/HEAD"])
			).trim();
			return originHead.replace(/^refs\/remotes\/origin\//, "");
		} catch {}

		for (const candidate of DEFAULT_BRANCH_CANDIDATES) {
			for (const namespace of ["refs/remotes/origin/", "refs/heads/"]) {
				if (await this.refExists(namespace + candidate)) {
					return candidate;
				}
			}
		}
		throw new Error(
			"could not determine the default branch: origin/HEAD is unset and neither main nor master exists",
		);
	}

	async currentBranch(): Promise<string | null> {
		const name = (await this.git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
		return name === "HEAD" ? null : name;
	}

	async localBranches(): Promise<string[]> {
		const output = await this.git([
			"for-each-ref",
			"--format=%(refname:short)",
			"refs/heads",
		]);
		return output
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "");
	}

	async isDirty(): Promise<boolean> {
		const output = await this.git(["status", "--porcelain=v2", "-z"]);
		return splitNulTerminated(output).some(
			(entry) =>
				entry.startsWith("1 ") ||
				entry.startsWith("2 ") ||
				entry.startsWith("u "),
		);
	}

	async statusPorcelain(): Promise<string> {
		return this.git(["status", "--porcelain"]);
	}

	async remoteUrl(remoteName: string): Promise<string> {
		return (await this.git(["remote", "get-url", remoteName])).trim();
	}

	async mergeBase(a: string, b: string): Promise<string> {
		return (await this.git(["merge-base", a, b])).trim();
	}

	async countCommits(from: string, to: string): Promise<number> {
		const raw = await this.git(["rev-list", "--count", `${from}..${to}`, "--"]);
		return Number.parseInt(raw.trim(), 10);
	}

	async diff(base: string, head: string): Promise<string> {
		return this.git([...DIFF_SAFE_CONFIG, "diff", ...DIFF_FLAGS, base, head]);
	}

	async diffWorktree(): Promise<string> {
		return this.git([...DIFF_SAFE_CONFIG, "diff", ...DIFF_FLAGS, "HEAD"]);
	}

	async readBlob(ref: string, path: string): Promise<Buffer> {
		return this.gitBuffer(["show", `${ref}:${path}`]);
	}

	async readIndexBlob(path: string): Promise<Buffer> {
		return this.gitBuffer(["show", `:${path}`]);
	}

	async readObject(oid: string): Promise<Buffer> {
		if (!OBJECT_ID.test(oid)) {
			throw new Error(`not an object id: ${oid}`);
		}
		return this.gitBuffer(["cat-file", "blob", oid]);
	}

	async readWorkingFile(path: string): Promise<Buffer> {
		const realRoot = await realpath(this.cwd);
		const realFile = await realpath(join(this.cwd, path));
		const isContained =
			realFile === realRoot || realFile.startsWith(realRoot + sep);
		if (!isContained) {
			throw new Error(`path escapes the repository: ${path}`);
		}
		return readFile(realFile);
	}

	async hashObject(path: string): Promise<string> {
		return (await this.git(["hash-object", "--", path])).trim();
	}

	async worktreeFingerprint(): Promise<string> {
		const [indexEntries, statusEntries] = await Promise.all([
			this.git(["ls-files", "-s", "-z"]),
			this.git(["status", "--porcelain=v2", "--untracked-files=all", "-z"]),
		]);

		const pairs: string[] = [];
		for (const entry of splitNulTerminated(indexEntries)) {
			pairs.push(`index\0${entry}`);
		}

		const worktreeSide = parseWorktreeSide(splitNulTerminated(statusEntries));
		pairs.push(
			...worktreeSide.deletedPaths.map((path) => `worktree\0${path}\0deleted`),
		);
		if (worktreeSide.pathsToHash.length > 0) {
			const oids = await this.hashWorktreeFiles(worktreeSide.pathsToHash);
			worktreeSide.pathsToHash.forEach((path, index) => {
				pairs.push(`worktree\0${path}\0${oids[index]}`);
			});
		}

		pairs.sort();
		return createHash("sha256").update(pairs.join("\n"), "utf8").digest("hex");
	}

	async fetchPrHead(prNumber: number): Promise<string> {
		const localRef = `refs/prreview/pr/${prNumber}`;
		await this.git([
			"fetch",
			"--no-tags",
			"origin",
			`+refs/pull/${prNumber}/head:${localRef}`,
		]);
		return this.verifyRef(localRef);
	}

	async addWorktree(dir: string, sha: string): Promise<void> {
		await this.git(["worktree", "add", "--detach", dir, sha]);
	}

	async removeWorktree(dir: string): Promise<void> {
		await this.git(["worktree", "remove", "--force", dir]);
	}

	async pruneWorktrees(): Promise<void> {
		await this.git(["worktree", "prune"]);
	}

	private async refExists(ref: string): Promise<boolean> {
		try {
			await this.git(["show-ref", "--verify", "--quiet", ref]);
			return true;
		} catch {
			return false;
		}
	}

	private async hashWorktreeFiles(paths: readonly string[]): Promise<string[]> {
		const output = await this.git(["hash-object", "--", ...paths]);
		return output.trim().split("\n");
	}

	private git(args: readonly string[]): Promise<string> {
		return exec("git", args, { cwd: this.cwd, env: REPO_FROM_CWD_ONLY });
	}

	private gitBuffer(args: readonly string[]): Promise<Buffer> {
		return execBuffer("git", args, { cwd: this.cwd, env: REPO_FROM_CWD_ONLY });
	}
}

function splitNulTerminated(output: string): string[] {
	return output.split("\0").filter((entry) => entry.length > 0);
}

interface WorktreeSide {
	pathsToHash: string[];
	deletedPaths: string[];
}

const HEADER_FIELDS: Record<string, number> = { "1": 8, "2": 9, u: 10 };

interface TrackedEntry {
	path: string;
	worktreeStatus: string;
	consumesNextField: boolean;
	unmerged: boolean;
}

function parseTrackedEntry(entry: string, kind: string): TrackedEntry {
	const fields = entry.split(" ");
	return {
		path: fields.slice(HEADER_FIELDS[kind]).join(" "),
		worktreeStatus: fields[1][1],
		consumesNextField: kind === "2",
		unmerged: kind === "u",
	};
}

function parseWorktreeSide(entries: readonly string[]): WorktreeSide {
	const pathsToHash: string[] = [];
	const deletedPaths: string[] = [];

	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index];
		const kind = entry[0];
		if (kind === "?") {
			pathsToHash.push(entry.slice(2));
			continue;
		}
		if (HEADER_FIELDS[kind] === undefined) {
			continue;
		}
		const tracked = parseTrackedEntry(entry, kind);
		if (tracked.consumesNextField) {
			index++;
		}
		if (tracked.worktreeStatus === "D") {
			deletedPaths.push(tracked.path);
		} else if (tracked.worktreeStatus !== "." || tracked.unmerged) {
			pathsToHash.push(tracked.path);
		}
	}

	return { pathsToHash, deletedPaths };
}
