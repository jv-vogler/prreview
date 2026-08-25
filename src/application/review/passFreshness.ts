import type { Git } from "../ports/Git";

/**
 * How the stored pass relates to the changeset being served: reviewed at
 * this very commit, N commits behind it, or not comparable at all — a
 * worktree changeset, an artifact from before `headSha` was recorded, or a
 * rewritten history the shas cannot bridge. What the "review again"
 * confirmation states as fact; never a guess.
 */
export type PassFreshness =
	| { kind: "same-commit" }
	| { kind: "new-commits"; count: number }
	| { kind: "unknown" };

export async function assessPassFreshness(
	deps: { git: Git },
	reviewedSha: string | null,
	currentSha: string | null,
): Promise<PassFreshness> {
	if (reviewedSha === null || currentSha === null) {
		return { kind: "unknown" };
	}
	if (reviewedSha === currentSha) {
		return { kind: "same-commit" };
	}
	try {
		const count = await deps.git.countCommits(reviewedSha, currentSha);
		// zero with differing shas means a rewritten or diverged history —
		// "the change moved" is true, but no honest count exists
		return count > 0 ? { kind: "new-commits", count } : { kind: "unknown" };
	} catch {
		// the reviewed commit may no longer exist locally (rebase, gc, a
		// re-fetched PR head) — unknown, never an error
		return { kind: "unknown" };
	}
}
