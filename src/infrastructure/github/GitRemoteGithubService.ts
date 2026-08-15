import type { Git } from "../../application/ports/Git";
import { GithubError } from "../../domain/errors/GithubError";
import type { Toolchain } from "../../domain/session/Toolchain";

/**
 * Read-only GithubService over plain git with the user's existing remote
 * auth (ARCHITECTURE §4): fetching a PR head is `git fetch origin
 * pull/N/head`, and the diff base falls back to the merge-base with the
 * default branch, since without the API the PR's declared base is unknown.
 * No metadata, no publishing.
 */
export class GitRemoteGithubService {
	private readonly git: Git;

	constructor(git: Git) {
		this.git = git;
	}

	/** Usable wherever an `origin` remote exists; no network involved. */
	async probe(): Promise<Toolchain["github"]> {
		try {
			await this.git.remoteUrl("origin");
			return { kind: "git-remote" };
		} catch {
			return { kind: "none" };
		}
	}

	async getPr(_number: number): Promise<never> {
		throw new GithubError(
			"unsupported-backend",
			"PR metadata needs the gh CLI; this repo only has plain git remote access.",
		);
	}

	async getCurrentBranchPr(): Promise<never> {
		throw new GithubError(
			"unsupported-backend",
			"Finding the current branch's PR needs the gh CLI; this repo only has plain git remote access.",
		);
	}

	async getPrDiff(number: number): Promise<string> {
		const headSha = await this.git.fetchPrHead(number);
		const base = await this.resolveDefaultBranchRef();
		const mergeBase = await this.git.mergeBase(base, headSha);
		return this.git.diff(mergeBase, headSha);
	}

	async fetchPrHead(number: number): Promise<string> {
		return this.git.fetchPrHead(number);
	}

	async findPendingReview(_pr: number): Promise<never> {
		throw publishNeedsGh();
	}

	async createPendingReview(_pr: number, _input: unknown): Promise<never> {
		throw publishNeedsGh();
	}

	async deletePendingReview(_id: string): Promise<never> {
		throw publishNeedsGh();
	}

	/**
	 * The default branch as a resolvable ref, preferring the remote-tracking
	 * ref (the PR's real ancestor) over a possibly stale local branch.
	 */
	private async resolveDefaultBranchRef(): Promise<string> {
		const name = await this.git.defaultBranch();
		try {
			return await this.git.verifyRef(`refs/remotes/origin/${name}`);
		} catch {
			return this.git.verifyRef(`refs/heads/${name}`);
		}
	}
}

function publishNeedsGh(): GithubError {
	return new GithubError(
		"unsupported-backend",
		"Publishing reviews to GitHub needs the gh CLI.",
	);
}
