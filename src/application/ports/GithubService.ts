import type { Toolchain } from "../../domain/session/Toolchain";

export interface PrInfo {
	title: string;
	body: string;
	baseRefName: string;
	headRefName: string;
	headRefOid: string;
	url: string;
	state: string;
}

export interface GithubComment {
	path: string;
	line: number;
	side: "LEFT" | "RIGHT";
	startLine?: number;
	startSide?: "LEFT" | "RIGHT";
	body: string;
}

export interface ReviewInput {
	body?: string;
	findings?: GithubComment[];
}

export interface PrReviewCommentInfo {
	id: number;
	inReplyToId: number | null;
	path: string;
	line: number | null;
	author: string;
	body: string;
}

export interface PendingReview {
	id: number;
	htmlUrl: string;
	state: string;
}

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
