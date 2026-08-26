import type {
	PendingReview,
	PrInfo,
	PrReviewCommentInfo,
	ReviewInput,
} from "../../domain/githubReview/GithubReview";
import type { Toolchain } from "../../domain/session/Toolchain";

export interface GithubService {
	probe(): Promise<Toolchain["github"]>;
	getPr(number: number): Promise<PrInfo>;
	getCurrentBranchPr(): Promise<PrInfo>;
	getPrDiff(number: number): Promise<string>;
	fetchPrHead(number: number): Promise<string>;
	listPrReviewComments(pr: number): Promise<PrReviewCommentInfo[]>;
	findPendingReview(pr: number): Promise<PendingReview | null>;
	createPendingReview(pr: number, input: ReviewInput): Promise<PendingReview>;
	deletePendingReview(pr: number, id: number): Promise<void>;
}
