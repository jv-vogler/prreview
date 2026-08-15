import type { HunkCoverage } from "./HunkCoverage";

const COVERAGE_RANK: Record<HunkCoverage, number> = {
	unseen: 0,
	viewed: 1,
	reviewed: 2,
};

/**
 * Monotonic upgrade, mirroring the server's rule exactly: coverage never
 * moves backward, so a hunk marked reviewed stays reviewed no matter what
 * later scroll events report.
 */
export function upgradeHunkCoverage(
	current: HunkCoverage,
	requested: HunkCoverage,
): HunkCoverage {
	return COVERAGE_RANK[requested] > COVERAGE_RANK[current]
		? requested
		: current;
}
