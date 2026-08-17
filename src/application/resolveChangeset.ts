import type { ChangesetRef } from "../domain/changeset/ChangesetRef";
import type { ChangesetSource } from "../domain/changeset/ChangesetSource";
import { AppError } from "../domain/errors/AppError";
import { ChangesetError } from "../domain/errors/ChangesetError";
import { GithubError } from "../domain/errors/GithubError";
import type { Toolchain } from "../domain/session/Toolchain";
import type { Git } from "./ports/Git";
import type { TicketHint } from "../domain/analysis/discoverTicket";
import { discoverTicket } from "../domain/analysis/discoverTicket";
import type { GithubService, PrInfo } from "./ports/GithubService";

const PR_NUMBER_PATTERN = /^\d+$/;
// host-agnostic on purpose: gh logins include GHES hosts (ARCHITECTURE §4)
const PR_URL_PATTERN =
	/^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/;
const RANGE_SEPARATOR = "..";
const WORKING_KEYWORD = "working";
const PR_OPEN_STATE = "OPEN";

const EXPLICIT_FORMS_HINT =
	"override with an explicit target: prreview <pr-number|pr-url>, prreview <branch> [base], prreview <from>..<to>, or prreview working";

/** Suggestions further away than this read as noise, not as "did you mean". */
const SUGGESTION_MAX_DISTANCE = 3;

export interface ResolveChangesetDeps {
	git: Git;
	githubService: GithubService | null;
	toolchain: Toolchain;
}

/** The CLI positionals, verbatim (PRODUCT §13: `prreview [target] [base]`). */
export interface ResolveChangesetInput {
	target?: string;
	base?: string;
}

/** REQ-008: what was resolved, and the explicit form that would override it. */
export interface ChangesetAnnounce {
	resolved: string;
	overrideHint: string;
}

export interface ResolvedChangeset {
	ref: ChangesetRef;
	announce: ChangesetAnnounce;
	/**
	 * What the change says it is for, when a reference was cheap to find.
	 *
	 * Discovered here because this is the one place PR metadata is already in
	 * hand — resolving a PR fetches title, body, and head branch anyway, so
	 * discovery costs nothing. Doing it later would mean a second `gh` call for
	 * data we already had.
	 */
	ticket: TicketHint | null;
}

export type ResolveChangeset = (
	input: ResolveChangesetInput,
) => Promise<ResolvedChangeset>;

/**
 * Turns the CLI positionals (or their absence) into a fully resolved
 * ChangesetRef (ARCHITECTURE §3). Positional disambiguation, in order: all
 * digits → PR number; a GitHub PR URL → that PR; contains `..` → range; the
 * literal `working` → the working tree; anything else → a branch. Auto-detect,
 * in order: dirty tree → working tree; the current branch's open PR when the
 * gh backend is available; the current branch against its merge-base with the
 * default branch; else a usage error.
 */
export function makeResolveChangeset(
	deps: ResolveChangesetDeps,
): ResolveChangeset {
	return async (input) => {
		const source =
			input.target === undefined
				? await autoDetectSource(deps)
				: await disambiguateTarget(deps, input.target, input.base);
		const ref = await resolveSourceRef(deps, source, input.target);
		return {
			ref,
			announce: announceFor(source, input.target),
			ticket: await discoverTicketFor(deps, source),
		};
	};
}

/**
 * Opportunistic ticket discovery from whatever the source already exposes.
 *
 * A PR gives the richest signal — head branch, title, body — and the metadata
 * is already fetched to resolve the ref, so this is free. A branch gives its
 * own name. A range or the working tree gives nothing, which is a fine answer:
 * the Overview tab then judges internal coherence and says so.
 *
 * Failures here are swallowed on purpose. A ticket is a nicety; a review that
 * refuses to open because a `gh` call hiccuped while looking for one would be
 * a bad trade.
 */
async function discoverTicketFor(
	deps: ResolveChangesetDeps,
	source: ChangesetSource,
): Promise<TicketHint | null> {
	if (source.kind === "branch") {
		return discoverTicket({ branch: source.branch });
	}
	if (source.kind !== "pr" || deps.githubService === null) {
		return null;
	}
	try {
		const info = await prInfoIfBackendHasMetadata(
			deps.githubService,
			source.number,
		);
		if (info === null) {
			return null;
		}
		return discoverTicket({
			branch: info.headRefName,
			title: info.title,
			body: info.body,
			selfIssueNumber: source.number,
		});
	} catch {
		return null;
	}
}

// ── positional disambiguation ───────────────────────────────────────────────

async function disambiguateTarget(
	deps: ResolveChangesetDeps,
	target: string,
	base: string | undefined,
): Promise<ChangesetSource> {
	if (PR_NUMBER_PATTERN.test(target)) {
		return {
			kind: "pr",
			repo: await repoSlugFor(deps, Number(target)),
			number: Number(target),
		};
	}

	const prUrl = target.match(PR_URL_PATTERN);
	if (prUrl !== null) {
		return {
			kind: "pr",
			repo: `${prUrl[1]}/${prUrl[2]}`,
			number: Number(prUrl[3]),
		};
	}

	if (target.includes(RANGE_SEPARATOR)) {
		return rangeSource(target);
	}

	if (target === WORKING_KEYWORD) {
		return { kind: "worktree" };
	}

	return {
		kind: "branch",
		branch: target,
		base: base ?? (await detectBaseBranch(deps.git)),
	};
}

/**
 * `from..to` and `from...to` both parse to the same source: range semantics
 * are always "what `to` adds over the common ancestor" (baseSha is the
 * merge-base, which for the ordinary linear `HEAD~3..HEAD` case IS `from`).
 * An empty side defaults to HEAD, as it does in git itself.
 */
function rangeSource(target: string): ChangesetSource {
	const separatorIndex = target.indexOf(RANGE_SEPARATOR);
	const separatorLength = target.startsWith("...", separatorIndex) ? 3 : 2;
	return {
		kind: "range",
		from: target.slice(0, separatorIndex) || "HEAD",
		to: target.slice(separatorIndex + separatorLength) || "HEAD",
	};
}

// ── auto-detect chain ───────────────────────────────────────────────────────

async function autoDetectSource(
	deps: ResolveChangesetDeps,
): Promise<ChangesetSource> {
	if (await deps.git.isDirty()) {
		return { kind: "worktree" };
	}

	if (deps.toolchain.github.kind === "gh" && deps.githubService !== null) {
		const openPr = await findCurrentBranchOpenPr(deps.githubService);
		const fromUrl = openPr === null ? null : prSourceFromUrl(openPr.url);
		if (fromUrl !== null) {
			return fromUrl;
		}
	}

	return currentBranchAgainstDefault(deps.git);
}

async function findCurrentBranchOpenPr(
	githubService: GithubService,
): Promise<PrInfo | null> {
	try {
		const pr = await githubService.getCurrentBranchPr();
		return pr.state === PR_OPEN_STATE ? pr : null;
	} catch {
		// "no pull requests found" (or any gh hiccup) only means this rung of
		// the auto-detect ladder does not apply; the next rung answers instead.
		return null;
	}
}

function prSourceFromUrl(url: string): ChangesetSource | null {
	const match = url.match(PR_URL_PATTERN);
	if (match === null) {
		return null;
	}
	return {
		kind: "pr",
		repo: `${match[1]}/${match[2]}`,
		number: Number(match[3]),
	};
}

async function currentBranchAgainstDefault(git: Git): Promise<ChangesetSource> {
	const branch = await currentBranchOrNull(git);
	const base = await defaultBranchOrNull(git);
	if (branch === null || base === null || branch === base) {
		throw new ChangesetError(
			"cannot-auto-detect",
			`Nothing to auto-detect: the working tree is clean, no open PR was found, and ${describeBranchState(branch, base)}. Tell prreview what to review — prreview 482, prreview <branch> [base], prreview HEAD~3..HEAD, or prreview working.`,
		);
	}
	return { kind: "branch", branch, base };
}

function describeBranchState(
	branch: string | null,
	base: string | null,
): string {
	if (branch === null) {
		return "HEAD is detached";
	}
	if (base === null) {
		return "no default branch could be determined";
	}
	return `the current branch is the default branch (${base})`;
}

async function currentBranchOrNull(git: Git): Promise<string | null> {
	try {
		return await git.currentBranch();
	} catch {
		// an unborn HEAD (fresh init, no commits) has nothing to review anyway
		return null;
	}
}

async function defaultBranchOrNull(git: Git): Promise<string | null> {
	try {
		return await git.defaultBranch();
	} catch {
		return null;
	}
}

async function detectBaseBranch(git: Git): Promise<string> {
	try {
		return await git.defaultBranch();
	} catch (error) {
		throw new ChangesetError(
			"cannot-auto-detect",
			"Could not determine a base branch (origin/HEAD is unset and neither main nor master exists) — pass one explicitly: prreview <branch> <base>.",
			{ cause: error },
		);
	}
}

// ── ref resolution (shared with refreshChangeset and detectDrift) ───────────

export interface SourceRefDeps {
	git: Git;
	githubService: GithubService | null;
}

/**
 * Resolves an already-identified source to the SHAs (and worktree
 * fingerprint) of its current state. This is the single definition of "what
 * does this changeset look like right now": resolveChangeset uses it at boot,
 * refreshChangeset on refresh, and detectDrift compares its output against
 * the current round's ref every poll tick.
 */
export async function resolveSourceRef(
	deps: SourceRefDeps,
	source: ChangesetSource,
	requestedAs?: string,
): Promise<ChangesetRef> {
	switch (source.kind) {
		case "worktree":
			return worktreeRef(deps.git, source, requestedAs);
		case "range":
			return rangeRef(deps.git, source, requestedAs);
		case "branch":
			return branchRef(deps.git, source, requestedAs);
		case "pr":
			return prRef(deps, source, requestedAs);
	}
}

async function worktreeRef(
	git: Git,
	source: ChangesetSource,
	requestedAs: string | undefined,
): Promise<ChangesetRef> {
	const [baseSha, worktreeFingerprint] = await Promise.all([
		git.verifyRef("HEAD"),
		git.worktreeFingerprint(),
	]);
	return {
		source,
		...requestedAsField(requestedAs),
		baseSha,
		headSha: null,
		worktreeFingerprint,
		resolvedAt: new Date().toISOString(),
	};
}

async function rangeRef(
	git: Git,
	source: Extract<ChangesetSource, { kind: "range" }>,
	requestedAs: string | undefined,
): Promise<ChangesetRef> {
	const headSha = await resolveRevisionOrNotFound(git, source.to);
	const fromSha = await resolveRevisionOrNotFound(git, source.from);
	return {
		source,
		...requestedAsField(requestedAs),
		baseSha: await git.mergeBase(fromSha, headSha),
		headSha,
		resolvedAt: new Date().toISOString(),
	};
}

async function branchRef(
	git: Git,
	source: Extract<ChangesetSource, { kind: "branch" }>,
	requestedAs: string | undefined,
): Promise<ChangesetRef> {
	const headSha = await resolveBranchOrSuggest(git, source.branch);
	const baseTipSha = await resolveBranchOrSuggest(git, source.base);
	return {
		source,
		...requestedAsField(requestedAs),
		baseSha: await git.mergeBase(baseTipSha, headSha),
		headSha,
		resolvedAt: new Date().toISOString(),
	};
}

async function prRef(
	deps: SourceRefDeps,
	source: Extract<ChangesetSource, { kind: "pr" }>,
	requestedAs: string | undefined,
): Promise<ChangesetRef> {
	const { git, githubService } = deps;
	if (githubService === null) {
		throw prNeedsGithub(source.number);
	}

	const info = await prInfoIfBackendHasMetadata(githubService, source.number);
	if (info !== null) {
		let headSha = info.headRefOid;
		if (!(await commitExistsLocally(git, headSha))) {
			headSha = await fetchPrHeadOrNotFound(githubService, source.number);
		}
		const baseTipSha = await resolvePrBaseTip(git, info.baseRefName);
		return {
			source,
			...requestedAsField(requestedAs),
			baseSha: await git.mergeBase(baseTipSha, headSha),
			headSha,
			resolvedAt: new Date().toISOString(),
		};
	}

	// metadata-less backend (plain git remote): fetching is the only way to
	// learn the head, and the base falls back to the default branch's
	// merge-base because the PR's declared base is unknown (ARCHITECTURE §4)
	const headSha = await fetchPrHeadOrNotFound(githubService, source.number);
	const defaultTipSha = await resolvePrBaseTip(
		git,
		await detectBaseBranch(git),
	);
	return {
		source,
		...requestedAsField(requestedAs),
		baseSha: await git.mergeBase(defaultTipSha, headSha),
		headSha,
		resolvedAt: new Date().toISOString(),
	};
}

// ── expected-failure conversions (CON-003: this layer gives failures meaning) ─

async function prInfoIfBackendHasMetadata(
	githubService: GithubService,
	number: number,
): Promise<PrInfo | null> {
	try {
		return await githubService.getPr(number);
	} catch (error) {
		if (
			error instanceof GithubError &&
			error.reason === "unsupported-backend"
		) {
			return null;
		}
		if (error instanceof AppError) {
			throw error;
		}
		throw prNotFound(number, error);
	}
}

async function fetchPrHeadOrNotFound(
	githubService: GithubService,
	number: number,
): Promise<string> {
	try {
		return await githubService.fetchPrHead(number);
	} catch (error) {
		if (error instanceof AppError) {
			throw error;
		}
		throw prNotFound(number, error);
	}
}

function prNotFound(number: number, cause: unknown): ChangesetError {
	return new ChangesetError(
		"pr-not-found",
		`Pull request #${number} was not found (or GitHub could not be reached).`,
		{ cause },
	);
}

function prNeedsGithub(number: number): GithubError {
	return new GithubError(
		"unsupported-backend",
		`Reviewing pull request #${number} needs the gh CLI or a GitHub remote named origin.`,
	);
}

async function commitExistsLocally(git: Git, sha: string): Promise<boolean> {
	try {
		await git.verifyRef(sha);
		return true;
	} catch {
		return false;
	}
}

/** The PR's base branch tip, preferring the remote-tracking ref (the PR's real ancestor). */
async function resolvePrBaseTip(git: Git, baseName: string): Promise<string> {
	try {
		return await git.verifyRef(`refs/remotes/origin/${baseName}`);
	} catch {
		return git.verifyRef(baseName);
	}
}

async function resolveRevisionOrNotFound(
	git: Git,
	revision: string,
): Promise<string> {
	try {
		return await git.verifyRef(revision);
	} catch (error) {
		throw new ChangesetError(
			"branch-not-found",
			`"${revision}" is not a revision this repository knows.`,
			{ cause: error },
		);
	}
}

async function resolveBranchOrSuggest(
	git: Git,
	branch: string,
): Promise<string> {
	try {
		return await git.verifyRef(branch);
	} catch (error) {
		const suggestion = closestBranch(branch, await localBranchesOrNone(git));
		const didYouMean =
			suggestion === null ? "" : ` Did you mean "${suggestion}"?`;
		throw new ChangesetError(
			"branch-not-found",
			`Branch "${branch}" not found.${didYouMean}`,
			{ cause: error },
		);
	}
}

async function localBranchesOrNone(git: Git): Promise<string[]> {
	try {
		return await git.localBranches();
	} catch {
		return [];
	}
}

function closestBranch(
	missing: string,
	candidates: readonly string[],
): string | null {
	let best: { name: string; distance: number } | null = null;
	for (const candidate of candidates) {
		const distance = editDistance(missing, candidate);
		if (best === null || distance < best.distance) {
			best = { name: candidate, distance };
		}
	}
	if (best === null || best.distance > SUGGESTION_MAX_DISTANCE) {
		return null;
	}
	return best.name;
}

/** Plain Levenshtein — small inputs (branch names), no need for anything smarter. */
function editDistance(a: string, b: string): number {
	let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let rowIndex = 1; rowIndex <= a.length; rowIndex++) {
		const currentRow = [rowIndex];
		for (let columnIndex = 1; columnIndex <= b.length; columnIndex++) {
			const substitutionCost = a[rowIndex - 1] === b[columnIndex - 1] ? 0 : 1;
			currentRow.push(
				Math.min(
					currentRow[columnIndex - 1] + 1,
					previousRow[columnIndex] + 1,
					previousRow[columnIndex - 1] + substitutionCost,
				),
			);
		}
		previousRow = currentRow;
	}
	return previousRow[b.length];
}

// ── the repo slug for a bare PR number (`pr:owner/repo#N` identity) ─────────

const REMOTE_URL_SLUG_PATTERN = /[/:]([^/:]+)\/([^/:]+?)(?:\.git)?\/?$/;

async function repoSlugFor(
	deps: ResolveChangesetDeps,
	prNumber: number,
): Promise<string> {
	const { githubService } = deps;
	if (githubService === null) {
		throw prNeedsGithub(prNumber);
	}

	if (deps.toolchain.github.kind === "gh") {
		const info = await prInfoIfBackendHasMetadata(githubService, prNumber);
		const fromUrl = info === null ? null : prSourceFromUrl(info.url);
		if (fromUrl !== null && fromUrl.kind === "pr") {
			return fromUrl.repo;
		}
	}

	let remoteUrl: string;
	try {
		remoteUrl = await deps.git.remoteUrl("origin");
	} catch (error) {
		throw new GithubError(
			"unsupported-backend",
			`Reviewing pull request #${prNumber} needs the gh CLI or a GitHub remote named origin.`,
			{ cause: error },
		);
	}
	const match = remoteUrl.trim().match(REMOTE_URL_SLUG_PATTERN);
	if (match === null) {
		throw new GithubError(
			"unsupported-backend",
			`The origin remote (${remoteUrl.trim()}) does not look like a GitHub repository, so pull request #${prNumber} cannot be identified.`,
		);
	}
	return `${match[1]}/${match[2]}`;
}

// ── the announcement (REQ-008) ──────────────────────────────────────────────

function announceFor(
	source: ChangesetSource,
	requestedAs: string | undefined,
): ChangesetAnnounce {
	const autoDetected = requestedAs === undefined;
	switch (source.kind) {
		case "worktree":
			return {
				resolved: autoDetected
					? "working tree changes (auto-detected: the checkout is dirty)"
					: "working tree changes (staged + unstaged)",
				overrideHint: EXPLICIT_FORMS_HINT,
			};
		case "pr":
			return {
				resolved: autoDetected
					? `pull request #${source.number} of ${source.repo} (auto-detected: the current branch's open PR)`
					: `pull request #${source.number} of ${source.repo}`,
				overrideHint: EXPLICIT_FORMS_HINT,
			};
		case "branch":
			return {
				resolved: autoDetected
					? `branch ${source.branch} against ${source.base} (auto-detected: merge-base with the default branch)`
					: `branch ${source.branch} against ${source.base}`,
				overrideHint: EXPLICIT_FORMS_HINT,
			};
		case "range":
			return {
				resolved: `commit range ${source.from}..${source.to}`,
				overrideHint: EXPLICIT_FORMS_HINT,
			};
	}
}

function requestedAsField(requestedAs: string | undefined): {
	requestedAs?: string;
} {
	return requestedAs === undefined ? {} : { requestedAs };
}
