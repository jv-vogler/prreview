import { GithubError } from "../../domain/errors/GithubError";
import type { Toolchain } from "../../domain/session/Toolchain";
import { exec } from "../git/exec";
import type { GitClient } from "../git/GitClient";
import type { PrInfo } from "./PrInfo";

/** Probes must answer fast and never touch the network (ARCHITECTURE §3). */
const PROBE_TIMEOUT_MS = 2000;

const PR_VIEW_JSON_FIELDS =
	"title,body,baseRefName,headRefName,headRefOid,url,state";

/**
 * Full-capability GithubService over the `gh` CLI, which inherits the user's
 * login including GHES hosts (ARCHITECTURE §4). Read side only in M1; the
 * publish methods arrive with M4. Failures of gh itself are thrown raw
 * (CON-003) — `pr-not-found` and friends are the use-cases' interpretation.
 */
export class GhCliGithubService {
	private readonly git: GitClient;
	private readonly cwd: string;

	constructor(git: GitClient, cwd: string) {
		this.git = git;
		this.cwd = cwd;
	}

	/**
	 * Can this backend work here? Requires gh to exist and to hold a token —
	 * both checked locally with tight timeouts, no network. A failed probe is
	 * an answer, not an error.
	 */
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

	async getPrDiff(number: number): Promise<string> {
		return this.gh(["pr", "diff", String(number)]);
	}

	async fetchPrHead(number: number): Promise<void> {
		await this.git.fetchPrHead(number);
	}

	async findPendingReview(_pr: number): Promise<never> {
		throw publishNotShippedYet();
	}

	async createPendingReview(_pr: number, _input: unknown): Promise<never> {
		throw publishNotShippedYet();
	}

	async deletePendingReview(_id: string): Promise<never> {
		throw publishNotShippedYet();
	}

	private gh(
		args: readonly string[],
		options: { timeoutMs?: number } = {},
	): Promise<string> {
		return exec("gh", args, { cwd: this.cwd, timeoutMs: options.timeoutMs });
	}
}

function publishNotShippedYet(): GithubError {
	return new GithubError(
		"unsupported-backend",
		"Publishing reviews to GitHub arrives in a later prreview release (M4).",
	);
}
