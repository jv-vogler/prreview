/**
 * SEC-003's honesty measure: the agent may write to the reviewed repo (a
 * temp test, a worktree it forgot to clean up), so prreview cannot promise
 * the tree comes back untouched. What it can do is notice and say so.
 *
 * Compares `git status --porcelain` before and after a run and returns the
 * paths that are new dirt — present after, absent before. A file already
 * dirty when the run started is the reader's own business, not the agent's.
 */
export function diffStatusResidue(before: string, after: string): string[] {
	const beforeLines = new Set(porcelainPaths(before));
	return porcelainPaths(after).filter((path) => !beforeLines.has(path));
}

function porcelainPaths(porcelain: string): string[] {
	return porcelain
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => line.slice(3).trim());
}
