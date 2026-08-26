import type {
	GithubService,
	PendingReview,
	PrInfo,
	PrReviewCommentInfo,
	ReviewInput,
} from "../../src/application/ports/GithubService";
import { GithubError } from "../../src/domain/errors/GithubError";
import type { Toolchain } from "../../src/domain/session/Toolchain";

export interface FakeGithubState {
	kind?: "gh" | "git-remote";
	prs?: Record<number, PrInfo>;
	currentBranchPr?: PrInfo | null;
	prDiffs?: Record<number, string>;
	prHeads?: Record<number, string>;
	pendingReviews?: Record<number, PendingReview>;
	prReviewComments?: Record<number, PrReviewCommentInfo[]>;
}

export class FakeGithubService implements GithubService {
	state: FakeGithubState;
	readonly fetchedPrHeads: number[] = [];
	readonly createdReviews: { pr: number; input: ReviewInput }[] = [];
	readonly deletedReviews: { pr: number; id: number }[] = [];

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

	async listPrReviewComments(pr: number): Promise<PrReviewCommentInfo[]> {
		return this.state.prReviewComments?.[pr] ?? [];
	}

	async findPendingReview(pr: number): Promise<PendingReview | null> {
		return this.state.pendingReviews?.[pr] ?? null;
	}

	async createPendingReview(
		pr: number,
		input: ReviewInput,
	): Promise<PendingReview> {
		this.createdReviews.push({ pr, input });
		return {
			id: 1,
			htmlUrl: "https://example.invalid/pull/1#review-1",
			state: "PENDING",
		};
	}

	async deletePendingReview(pr: number, id: number): Promise<void> {
		this.deletedReviews.push({ pr, id });
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
