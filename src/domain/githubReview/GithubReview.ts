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
