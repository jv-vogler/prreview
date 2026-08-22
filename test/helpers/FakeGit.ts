import type { Git } from "../../src/application/ports/Git";

/**
 * Knobs for the in-memory Git fake. Everything is optional; the defaults
 * describe a clean checkout of `main` with one commit. Mutate `state` inside
 * a test to simulate the repo moving.
 */
export interface FakeGitState {
	/** ref or revision name → commit sha (verifyRef's lookup table) */
	refs?: Record<string, string>;
	/** bare SHAs that exist in the object database (PR head presence checks) */
	objects?: string[];
	branches?: string[];
	/** null = detached HEAD */
	currentBranch?: string | null;
	/** null = defaultBranch() throws (no origin/HEAD, no main/master) */
	defaultBranch?: string | null;
	dirty?: boolean;
	/** raw `git status --porcelain` text (statusPorcelain's answer) */
	statusPorcelain?: string;
	/**
	 * Successive answers to `statusPorcelain()` calls, one per call in order
	 * (the last entry repeats once exhausted) — for tests that need a
	 * before/after difference. Takes precedence over `statusPorcelain`.
	 */
	statusPorcelainSequence?: string[];
	fingerprint?: string;
	/** `${aSha}..${bSha}` → merge-base sha; absent pairs fall back to aSha (linear history) */
	mergeBases?: Record<string, string>;
	/** `${baseSha}..${headSha}` → diff text; absent pairs yield an empty diff */
	diffs?: Record<string, string>;
	worktreeDiff?: string;
	remotes?: Record<string, string>;
	gitCommonDir?: string;
	/** `${ref}:${path}` → committed blob content (readBlob's lookup table) */
	blobs?: Record<string, string | Buffer>;
	/** path → staged blob content (readIndexBlob's lookup table) */
	indexBlobs?: Record<string, string | Buffer>;
	/** oid → blob content (readObject's lookup table) */
	objectContents?: Record<string, string | Buffer>;
	/** repo-relative path → working-tree content (readWorkingFile's table) */
	workingFiles?: Record<string, string | Buffer>;
}

const DEFAULT_HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/** One recorded `git worktree` call, so tests can assert the lifecycle. */
export interface FakeWorktreeCall {
	action: "add" | "remove" | "prune";
	dir?: string;
	sha?: string;
}

export class FakeGit implements Git {
	state: FakeGitState;
	/** every worktree call in order */
	readonly worktrees: FakeWorktreeCall[] = [];
	private statusPorcelainCallCount = 0;

	constructor(state: FakeGitState = {}) {
		this.state = { ...state };
	}

	async repoRoot(): Promise<string> {
		return "/repo";
	}

	async gitCommonDir(): Promise<string> {
		return this.state.gitCommonDir ?? "/repo/.git";
	}

	async verifyRef(ref: string): Promise<string> {
		const refs = this.state.refs ?? { HEAD: DEFAULT_HEAD_SHA };
		const sha = refs[ref];
		if (sha !== undefined) {
			return sha;
		}
		if (this.state.objects?.includes(ref)) {
			return ref;
		}
		throw new Error(`fake git: unknown revision ${ref}`);
	}

	async defaultBranch(): Promise<string> {
		if (this.state.defaultBranch === null) {
			throw new Error("fake git: could not determine the default branch");
		}
		return this.state.defaultBranch ?? "main";
	}

	async currentBranch(): Promise<string | null> {
		return this.state.currentBranch === undefined
			? "main"
			: this.state.currentBranch;
	}

	async localBranches(): Promise<string[]> {
		return this.state.branches ?? [];
	}

	async isDirty(): Promise<boolean> {
		return this.state.dirty ?? false;
	}

	async statusPorcelain(): Promise<string> {
		const sequence = this.state.statusPorcelainSequence;
		if (sequence === undefined || sequence.length === 0) {
			return this.state.statusPorcelain ?? "";
		}
		const index = Math.min(this.statusPorcelainCallCount, sequence.length - 1);
		this.statusPorcelainCallCount++;
		return sequence[index] ?? "";
	}

	async remoteUrl(remoteName: string): Promise<string> {
		const url = this.state.remotes?.[remoteName];
		if (url === undefined) {
			throw new Error(`fake git: no such remote ${remoteName}`);
		}
		return url;
	}

	async mergeBase(a: string, b: string): Promise<string> {
		return this.state.mergeBases?.[`${a}..${b}`] ?? a;
	}

	async diff(base: string, head: string): Promise<string> {
		return this.state.diffs?.[`${base}..${head}`] ?? "";
	}

	async diffWorktree(): Promise<string> {
		return this.state.worktreeDiff ?? "";
	}

	async readBlob(ref: string, path: string): Promise<Buffer> {
		const content = this.state.blobs?.[`${ref}:${path}`];
		if (content === undefined) {
			throw new Error(`fake git: no blob at ${ref}:${path}`);
		}
		return Buffer.from(content);
	}

	async readIndexBlob(path: string): Promise<Buffer> {
		const content = this.state.indexBlobs?.[path];
		if (content === undefined) {
			throw new Error(`fake git: no staged blob at ${path}`);
		}
		return Buffer.from(content);
	}

	async readObject(oid: string): Promise<Buffer> {
		const content = this.state.objectContents?.[oid];
		if (content === undefined) {
			throw new Error(`fake git: no object ${oid}`);
		}
		return Buffer.from(content);
	}

	async readWorkingFile(path: string): Promise<Buffer> {
		const content = this.state.workingFiles?.[path];
		if (content === undefined) {
			throw new Error(`fake git: no working file at ${path}`);
		}
		return Buffer.from(content);
	}

	async addWorktree(dir: string, sha: string): Promise<void> {
		this.worktrees.push({ action: "add", dir, sha });
	}

	async removeWorktree(dir: string): Promise<void> {
		this.worktrees.push({ action: "remove", dir });
	}

	async pruneWorktrees(): Promise<void> {
		this.worktrees.push({ action: "prune" });
	}

	async hashObject(_path: string): Promise<string> {
		throw new Error("fake git: hashObject is not modelled");
	}

	async worktreeFingerprint(): Promise<string> {
		return this.state.fingerprint ?? "fingerprint-0";
	}

	async fetchPrHead(_prNumber: number): Promise<string> {
		throw new Error(
			"fake git: use-cases fetch PR heads through the GithubService port",
		);
	}
}
