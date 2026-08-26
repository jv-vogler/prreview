import type { Git } from "../ports/Git";

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

		return count > 0 ? { kind: "new-commits", count } : { kind: "unknown" };
	} catch {
		return { kind: "unknown" };
	}
}
