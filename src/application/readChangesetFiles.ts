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

/**
 * The diff text for a resolved changeset, parsed into the IR: the source
 * text is `git diff -M -C --unified=3` or the GithubService's PR diff; every
 * changeset source goes through the same parser.
 */
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
		return deps.githubService.getPrDiff(source.number);
	}
	if (ref.headSha === null) {
		throw new Error(
			"a commit-to-commit changeset always resolves with a head sha",
		);
	}
	return deps.git.diff(ref.baseSha, ref.headSha);
}
