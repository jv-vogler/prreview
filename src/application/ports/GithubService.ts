import type { Toolchain } from "../../domain/session/Toolchain";

/**
 * PR metadata. Field names mirror `gh pr view --json` verbatim so the gh
 * adapter is a straight parse.
 */
export interface PrInfo {
	title: string;
	body: string;
	baseRefName: string;
	headRefName: string;
	headRefOid: string;
	url: string;
	state: string;
}

/**
 * One comment in a review's `comments[]` (docs/github-review-notes.md,
 * TASK-015): `startLine`/`startSide` are omitted for a single-line comment,
 * present for a genuine range — GitHub accepts a range spanning hunk
 * boundaries as-is, so callers never need to collapse one to a single line.
 */
export interface GithubComment {
	path: string;
	line: number;
	side: "LEFT" | "RIGHT";
	startLine?: number;
	startSide?: "LEFT" | "RIGHT";
	body: string;
}

/**
 * What `createPendingReview` sends. Per docs/github-review-notes.md
 * (TASK-016), GitHub validates the whole batch atomically: one unresolvable
 * comment 422s the request and keeps nothing, including the good ones — so
 * callers must pre-validate every comment before calling this.
 */
export interface ReviewInput {
	body?: string;
	findings?: GithubComment[];
}

/**
 * One inline review comment already on the PR — anyone's, replies included.
 * What a re-review reads to know which previous findings the conversation
 * has answered. `line` is null when GitHub has marked the comment outdated.
 */
export interface PrReviewCommentInfo {
	id: number;
	/** the comment this one replies to, or null for a thread opener */
	inReplyToId: number | null;
	path: string;
	line: number | null;
	author: string;
	body: string;
}

/** A review draft sitting on GitHub, not yet submitted by the user. */
export interface PendingReview {
	id: number;
	htmlUrl: string;
	state: string;
}

/**
 * Everything GitHub goes through this one port, implemented by
 * GhCliGithubService (full capability, via the `gh` CLI). Failures reject
 * raw; use-cases convert what they expect into typed AppErrors. probe()
 * never rejects — "can't work here" is its answer, not an error.
 */
export interface GithubService {
	probe(): Promise<Toolchain["github"]>;
	getPr(number: number): Promise<PrInfo>;
	/** the PR belonging to the checked-out branch — the auto-detect rung */
	getCurrentBranchPr(): Promise<PrInfo>;
	getPrDiff(number: number): Promise<string>;
	/** makes the head commit available locally; resolves with its sha */
	fetchPrHead(number: number): Promise<string>;
	/** every inline review comment on the PR, replies included, oldest first */
	listPrReviewComments(pr: number): Promise<PrReviewCommentInfo[]>;
	/** the caller's own pending review on this PR, or null if there is none */
	findPendingReview(pr: number): Promise<PendingReview | null>;
	/** event is always omitted (docs/github-review-notes.md): the review lands PENDING */
	createPendingReview(pr: number, input: ReviewInput): Promise<PendingReview>;
	deletePendingReview(pr: number, id: number): Promise<void>;
}
