import type {
	GithubService,
	PendingReview,
	PrInfo,
	PublishResult,
	ReviewInput,
} from "../../src/application/ports/GithubService";
import { GithubError } from "../../src/domain/errors/GithubError";
import type { Toolchain } from "../../src/domain/session/Toolchain";

/**
 * Knobs for the in-memory GithubService fake. `kind: "git-remote"` mirrors
 * the real GitRemoteGithubService: metadata methods throw
 * GithubError('unsupported-backend') while fetch/diff still work.
 */
export interface FakeGithubState {
	kind?: "gh" | "git-remote";
	prs?: Record<number, PrInfo>;
	/** null (the default) = "no pull requests found" for the current branch */
	currentBranchPr?: PrInfo | null;
	prDiffs?: Record<number, string>;
	/** fetchPrHead result per PR; falls back to the PR's headRefOid */
	prHeads?: Record<number, string>;
}

export class FakeGithubService implements GithubService {
	state: FakeGithubState;
	readonly fetchedPrHeads: number[] = [];

	constructor(state: FakeGithubState = {}) {
		this.state = { ...state };
	}

	async probe(): Promise<Toolchain["github"]> {
		return { kind: this.state.kind ?? "gh" };
	}

	async getPr(number: number): Promise<PrInfo> {
		this.throwIfMetadataless("PR metadata");
		const pr = this.state.prs?.[number];
		if (pr === undefined) {
			throw new Error(`fake gh: no pull request #${number}`);
		}
		return pr;
	}

	async getCurrentBranchPr(): Promise<PrInfo> {
		this.throwIfMetadataless("Finding the current branch's PR");
		const pr = this.state.currentBranchPr;
		if (pr === null || pr === undefined) {
			throw new Error("fake gh: no pull requests found for this branch");
		}
		return pr;
	}

	async getPrDiff(number: number): Promise<string> {
		const diff = this.state.prDiffs?.[number];
		if (diff === undefined) {
			throw new Error(`fake gh: no diff for pull request #${number}`);
		}
		return diff;
	}

	async fetchPrHead(number: number): Promise<string> {
		this.fetchedPrHeads.push(number);
		const sha =
			this.state.prHeads?.[number] ?? this.state.prs?.[number]?.headRefOid;
		if (sha === undefined) {
			throw new Error(`fake gh: cannot fetch head of pull request #${number}`);
		}
		return sha;
	}

	async findPendingReview(_pr: number): Promise<PendingReview | null> {
		return null;
	}

	async createPendingReview(
		_pr: number,
		_input: ReviewInput,
	): Promise<PublishResult> {
		throw new Error("fake gh: publishing arrives in M4");
	}

	async deletePendingReview(_id: string): Promise<void> {
		throw new Error("fake gh: publishing arrives in M4");
	}

	private throwIfMetadataless(what: string): void {
		if (this.state.kind === "git-remote") {
			throw new GithubError(
				"unsupported-backend",
				`${what} needs the gh CLI; this repo only has plain git remote access.`,
			);
		}
	}
}
