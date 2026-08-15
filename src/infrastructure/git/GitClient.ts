import { createHash } from "node:crypto";
import { exec, execBuffer } from "./exec";

/**
 * Config overrides that keep diff output parseable regardless of the user's
 * gitconfig: quoted non-ASCII paths, missing a/ b/ prefixes (diff.noprefix),
 * or i/ w/ mnemonic prefixes would each break gitdiff-parser or the paths in
 * the IR.
 */
const DIFF_SAFE_CONFIG = [
	"-c",
	"core.quotepath=false",
	"-c",
	"diff.noprefix=false",
	"-c",
	"diff.mnemonicPrefix=false",
];

/**
 * Flags matching ARCHITECTURE §5's canonical diff text (`git diff -M -C
 * --unified=3`), plus overrides so user config (color, external diff drivers,
 * textconv) cannot alter what the parser sees.
 */
const DIFF_FLAGS = [
	"-M",
	"-C",
	"--unified=3",
	"--no-color",
	"--no-ext-diff",
	"--no-textconv",
];

const DEFAULT_BRANCH_CANDIDATES = ["main", "master"];

/**
 * Local git adapter (the concrete side of the `Git` port, declared in Phase
 * 5). Every method shells out to the real git binary; failures are thrown
 * raw per CON-003 — the use-cases upstairs decide what a failure means.
 */
export class GitClient {
	private readonly cwd: string;

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	async repoRoot(): Promise<string> {
		return (await this.git(["rev-parse", "--show-toplevel"])).trim();
	}

	/** Absolute path even in worktrees — this is where info/exclude lives (SEC-003). */
	async gitCommonDir(): Promise<string> {
		return (
			await this.git([
				"rev-parse",
				"--path-format=absolute",
				"--git-common-dir",
			])
		).trim();
	}

	/** Resolves a ref to its commit sha; throws raw when the ref does not exist. */
	async verifyRef(ref: string): Promise<string> {
		return (
			await this.git(["rev-parse", "--verify", "--end-of-options", ref])
		).trim();
	}

	/**
	 * The repo's default branch name: from origin/HEAD when set (clones have
	 * it), else probing main → master on both the origin remote and local
	 * heads. Throws raw when nothing matches; resolveChangeset turns that
	 * into its usage error.
	 */
	async defaultBranch(): Promise<string> {
		try {
			const originHead = (
				await this.git(["symbolic-ref", "refs/remotes/origin/HEAD"])
			).trim();
			return originHead.replace(/^refs\/remotes\/origin\//, "");
		} catch {
			// origin/HEAD is only set by clone; fall through to the probe.
		}

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

	/** The remote's URL; throws raw when the remote does not exist (the git-remote probe). */
	async remoteUrl(remoteName: string): Promise<string> {
		return (await this.git(["remote", "get-url", remoteName])).trim();
	}

	async mergeBase(a: string, b: string): Promise<string> {
		return (await this.git(["merge-base", a, b])).trim();
	}

	/** Canonical diff text between two commits (ARCHITECTURE §5). */
	async diff(base: string, head: string): Promise<string> {
		return this.git([...DIFF_SAFE_CONFIG, "diff", ...DIFF_FLAGS, base, head]);
	}

	/**
	 * The worktree changeset: staged and unstaged together, versus HEAD.
	 * Untracked files are not part of a git diff and do not appear.
	 */
	async diffWorktree(): Promise<string> {
		return this.git([...DIFF_SAFE_CONFIG, "diff", ...DIFF_FLAGS, "HEAD"]);
	}

	/** Blob content at `ref:path`, raw bytes (the blob endpoint checks size/binary itself). */
	async readBlob(ref: string, path: string): Promise<Buffer> {
		return this.gitBuffer(["show", `${ref}:${path}`]);
	}

	/** Staged (index, stage 0) blob content for one path. */
	async readIndexBlob(path: string): Promise<Buffer> {
		return this.gitBuffer(["show", `:${path}`]);
	}

	/** The oid the worktree file would have as a blob — the staleness check for BlobRef. */
	async hashObject(path: string): Promise<string> {
		return (await this.git(["hash-object", "--", path])).trim();
	}

	/**
	 * sha256 over sorted (path, oid) pairs covering both the index
	 * (`ls-files -s`) and the worktree side of every dirty or untracked path
	 * (`status --porcelain=v2`, worktree files hashed via `hash-object`).
	 * Any edit, stage, unstage, delete, or new file changes the fingerprint;
	 * mtime-only touches do not. This is the 5s drift poll (ARCHITECTURE §3).
	 */
	async worktreeFingerprint(): Promise<string> {
		const [indexEntries, statusEntries] = await Promise.all([
			this.git(["ls-files", "-s", "-z"]),
			this.git(["status", "--porcelain=v2", "--untracked-files=all", "-z"]),
		]);

		const pairs: string[] = [];
		for (const entry of splitNulTerminated(indexEntries)) {
			// "<mode> <oid> <stage>\t<path>"
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

	/**
	 * Makes a PR's head commit available locally by fetching GitHub's
	 * `refs/pull/N/head` into `refs/prreview/pr/N` — a named ref rather than
	 * bare FETCH_HEAD, because FETCH_HEAD is overwritten by any later fetch
	 * and an unreferenced head is gc-bait mid-session. Returns the head sha.
	 */
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

	private async refExists(ref: string): Promise<boolean> {
		try {
			await this.git(["show-ref", "--verify", "--quiet", ref]);
			return true;
		} catch {
			return false;
		}
	}

	private async hashWorktreeFiles(paths: readonly string[]): Promise<string[]> {
		// One exec for the whole dirty set, one oid per output line. A path
		// that vanishes mid-poll fails the tick raw; the poller edge logs and
		// retries next tick (CON-003 edge #4).
		const output = await this.git(["hash-object", "--", ...paths]);
		return output.trim().split("\n");
	}

	private git(args: readonly string[]): Promise<string> {
		return exec("git", args, {
			cwd: this.cwd,
			// A git that decides to prompt (credentials on fetch) would hang a
			// headless server forever; failing raw is always better.
			env: { GIT_TERMINAL_PROMPT: "0" },
		});
	}

	private gitBuffer(args: readonly string[]): Promise<Buffer> {
		return execBuffer("git", args, {
			cwd: this.cwd,
			env: { GIT_TERMINAL_PROMPT: "0" },
		});
	}
}

function splitNulTerminated(output: string): string[] {
	return output.split("\0").filter((entry) => entry.length > 0);
}

interface WorktreeSide {
	pathsToHash: string[];
	deletedPaths: string[];
}

/**
 * Extracts the worktree-side state from `status --porcelain=v2 -z` entries.
 * Entry forms: "1 <XY> … <path>", "2 <XY> … <path>" followed by the original
 * path as its own NUL field, "u … <path>" (unmerged), "? <path>" (untracked).
 * Only paths whose *worktree* differs from the index need hashing — the index
 * side is already covered by ls-files.
 */
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
		if (kind === "1" || kind === "2" || kind === "u") {
			const fields = entry.split(" ");
			const headerFieldCount = kind === "1" ? 8 : kind === "2" ? 9 : /* u */ 10;
			const path = fields.slice(headerFieldCount).join(" ");
			if (kind === "2") {
				// the original path arrives as the next NUL-separated field
				index++;
			}
			const worktreeStatus = fields[1][1];
			if (worktreeStatus === "D") {
				deletedPaths.push(path);
			} else if (worktreeStatus !== "." || kind === "u") {
				pathsToHash.push(path);
			}
		}
	}

	return { pathsToHash, deletedPaths };
}
