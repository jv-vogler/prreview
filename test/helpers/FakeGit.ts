import type { Git } from "../../src/application/ports/Git";

export interface FakeGitState {
	refs?: Record<string, string>;
	objects?: string[];
	branches?: string[];
	currentBranch?: string | null;
	defaultBranch?: string | null;
	dirty?: boolean;
	statusPorcelain?: string;
	statusPorcelainSequence?: string[];
	fingerprint?: string;
	mergeBases?: Record<string, string>;
	commitCounts?: Record<string, number>;
	diffs?: Record<string, string>;
	worktreeDiff?: string;
	remotes?: Record<string, string>;
	gitCommonDir?: string;
	blobs?: Record<string, string | Buffer>;
	indexBlobs?: Record<string, string | Buffer>;
	objectContents?: Record<string, string | Buffer>;
	workingFiles?: Record<string, string | Buffer>;
}

const DEFAULT_HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export interface FakeWorktreeCall {
	action: "add" | "remove" | "prune";
	dir?: string;
	sha?: string;
}

export class FakeGit implements Git {
	state: FakeGitState;

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

	async countCommits(from: string, to: string): Promise<number> {
		const count = this.state.commitCounts?.[`${from}..${to}`];
		if (count === undefined) {
			throw new Error(`fake git: unknown range ${from}..${to}`);
		}
		return count;
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
