import gitDiffParser from "gitdiff-parser";
import type { ChangesetRef } from "../domain/changeset/ChangesetRef";
import type { FileDiff } from "../domain/changeset/FileDiff";
import { parseDiff } from "../domain/changeset/parseDiff";
import { GithubError } from "../domain/errors/GithubError";
import type { Git } from "./ports/Git";
import type { GithubService } from "./ports/GithubService";

export interface ReadChangesetFilesDeps {
	git: Git;
	githubService: GithubService | null;
}

export async function readChangesetFiles(
	deps: ReadChangesetFilesDeps,
	ref: ChangesetRef,
): Promise<FileDiff[]> {
	const diffText = await diffTextFor(deps, ref);
	return parseDiff(gitDiffParser.parse(diffText));
}

async function diffTextFor(
	deps: ReadChangesetFilesDeps,
	ref: ChangesetRef,
): Promise<string> {
	const { source } = ref;
	if (source.kind === "worktree") {
		return deps.git.diffWorktree();
	}
	if (source.kind === "pr") {
		if (deps.githubService === null) {
			throw new GithubError(
				"unsupported-backend",
				`Reviewing pull request #${source.number} needs the gh CLI or a GitHub remote named origin.`,
			);
		}
		return prDiffOrTooLarge(deps.githubService, source.number);
	}
	if (ref.headSha === null) {
		throw new Error(
			"a commit-to-commit changeset always resolves with a head sha",
		);
	}
	return deps.git.diff(ref.baseSha, ref.headSha);
}

async function prDiffOrTooLarge(
	githubService: GithubService,
	number: number,
): Promise<string> {
	try {
		return await githubService.getPrDiff(number);
	} catch (error) {
		if (looksTooLarge(error)) {
			throw new GithubError(
				"diff-too-large",
				`Pull request #${number}'s diff is too large to serve whole. Consider splitting it into smaller stacked PRs and reviewing them one at a time.`,
				{ cause: error },
			);
		}
		throw error;
	}
}

const TOO_LARGE_PATTERN = /too[ _]large|exceeded|maximum number/i;

function looksTooLarge(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const stderr =
		"stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
	return (
		TOO_LARGE_PATTERN.test(error.message) || TOO_LARGE_PATTERN.test(stderr)
	);
}
