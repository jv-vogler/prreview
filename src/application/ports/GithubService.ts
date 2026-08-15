import type { Toolchain } from "../../domain/session/Toolchain";

/**
 * PR metadata (ARCHITECTURE §4: "title, body, base, head, url"). Field names
 * mirror `gh pr view --json` verbatim so the gh adapter is a straight parse.
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

/** A review draft already sitting on GitHub. Publishing arrives in M4. */
export interface PendingReview {
	id: string;
}

/** What a publish sends. M4 specifies it; until then nothing constructs one. */
export type ReviewInput = unknown;

/** Publish outcome shape fixed by ARCHITECTURE §8. */
export interface PublishResult {
	reviewUrl: string;
	publishedCount: number;
	skipped: { annotationId: string; reason: string }[];
}

/**
 * Everything GitHub goes through this one port (ARCHITECTURE §4), implemented
 * by GhCliGithubService (full capability) and GitRemoteGithubService
 * (read-only subset). Failures reject raw (CON-003), with one exception the
 * architecture carves out: a metadata-less backend answers capability gaps
 * with GithubError('unsupported-backend'). probe() never rejects — "can't
 * work here" is its answer, not an error.
 */
export interface GithubService {
	probe(): Promise<Toolchain["github"]>;
	getPr(number: number): Promise<PrInfo>;
	/** the PR belonging to the checked-out branch — the auto-detect rung */
	getCurrentBranchPr(): Promise<PrInfo>;
	getPrDiff(number: number): Promise<string>;
	/** makes the head commit available locally; resolves with its sha */
	fetchPrHead(number: number): Promise<string>;
	findPendingReview(pr: number): Promise<PendingReview | null>;
	createPendingReview(pr: number, input: ReviewInput): Promise<PublishResult>;
	deletePendingReview(id: string): Promise<void>;
}
