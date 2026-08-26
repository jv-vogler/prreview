import type { Git } from "../../application/ports/Git";
import type {
	GithubService,
	PendingReview,
	PrInfo,
	PrReviewCommentInfo,
	ReviewInput,
} from "../../application/ports/GithubService";
import type { Toolchain } from "../../domain/session/Toolchain";
import { exec } from "../git/exec";

const PROBE_TIMEOUT_MS = 2000;

const PR_VIEW_JSON_FIELDS =
	"title,body,baseRefName,headRefName,headRefOid,url,state";

const REVIEWS_ENDPOINT = (pr: number) =>
	`repos/{owner}/{repo}/pulls/${pr}/reviews`;
const REVIEW_ENDPOINT = (pr: number, id: number) =>
	`repos/{owner}/{repo}/pulls/${pr}/reviews/${id}`;

const REVIEW_COMMENTS_ENDPOINT = (pr: number) =>
	`repos/{owner}/{repo}/pulls/${pr}/comments`;

const PENDING_STATE = "PENDING";

interface RawGithubComment {
	id: number;
	in_reply_to_id?: number;
	path: string;
	line: number | null;
	user: { login: string } | null;
	body: string;
}

interface RawReview {
	id: number;
	html_url: string;
	state: string;
}

export class GhCliGithubService implements GithubService {
	private readonly git: Git;
	private readonly cwd: string;

	constructor(git: Git, cwd: string) {
		this.git = git;
		this.cwd = cwd;
	}

	async probe(): Promise<Toolchain["github"]> {
		try {
			await this.gh(["--version"], { timeoutMs: PROBE_TIMEOUT_MS });
			await this.gh(["auth", "token"], { timeoutMs: PROBE_TIMEOUT_MS });
			return { kind: "gh" };
		} catch {
			return { kind: "none" };
		}
	}

	async getPr(number: number): Promise<PrInfo> {
		const json = await this.gh([
			"pr",
			"view",
			String(number),
			"--json",
			PR_VIEW_JSON_FIELDS,
		]);
		return JSON.parse(json) as PrInfo;
	}

	async getCurrentBranchPr(): Promise<PrInfo> {
		const json = await this.gh(["pr", "view", "--json", PR_VIEW_JSON_FIELDS]);
		return JSON.parse(json) as PrInfo;
	}

	async getPrDiff(number: number): Promise<string> {
		return this.gh(["pr", "diff", String(number)]);
	}

	async fetchPrHead(number: number): Promise<string> {
		return this.git.fetchPrHead(number);
	}

	async listPrReviewComments(pr: number): Promise<PrReviewCommentInfo[]> {
		const json = await this.gh([
			"api",
			"--paginate",
			"--slurp",
			REVIEW_COMMENTS_ENDPOINT(pr),
		]);
		const pages = JSON.parse(json) as RawGithubComment[][];
		return pages.flat().map((finding) => ({
			id: finding.id,
			inReplyToId: finding.in_reply_to_id ?? null,
			path: finding.path,
			line: finding.line,
			author: finding.user?.login ?? "unknown",
			body: finding.body,
		}));
	}

	async findPendingReview(pr: number): Promise<PendingReview | null> {
		const json = await this.gh(["api", REVIEWS_ENDPOINT(pr)]);
		const reviews = JSON.parse(json) as RawReview[];
		const pending = reviews.find((review) => review.state === PENDING_STATE);
		return pending === undefined ? null : toPendingReview(pending);
	}

	async createPendingReview(
		pr: number,
		input: ReviewInput,
	): Promise<PendingReview> {
		const payload = JSON.stringify(toWirePayload(input));
		const json = await this.gh(
			["api", REVIEWS_ENDPOINT(pr), "-X", "POST", "--input", "-"],
			{ stdin: payload },
		);
		return toPendingReview(JSON.parse(json) as RawReview);
	}

	async deletePendingReview(pr: number, id: number): Promise<void> {
		await this.gh(["api", REVIEW_ENDPOINT(pr, id), "-X", "DELETE"]);
	}

	private gh(
		args: readonly string[],
		options: { timeoutMs?: number; stdin?: string } = {},
	): Promise<string> {
		return exec("gh", args, {
			cwd: this.cwd,
			timeoutMs: options.timeoutMs,
			stdin: options.stdin,
		});
	}
}

function toPendingReview(review: RawReview): PendingReview {
	return { id: review.id, htmlUrl: review.html_url, state: review.state };
}

function toWirePayload(input: ReviewInput): {
	body?: string;
	findings?: {
		path: string;
		line: number;
		side: "LEFT" | "RIGHT";
		start_line?: number;
		start_side?: "LEFT" | "RIGHT";
		body: string;
	}[];
} {
	return {
		...(input.body === undefined ? {} : { body: input.body }),
		...(input.findings === undefined
			? {}
			: {
					findings: input.findings.map((finding) => ({
						path: finding.path,
						line: finding.line,
						side: finding.side,
						...(finding.startLine === undefined
							? {}
							: { start_line: finding.startLine }),
						...(finding.startSide === undefined
							? {}
							: { start_side: finding.startSide }),
						body: finding.body,
					})),
				}),
	};
}
