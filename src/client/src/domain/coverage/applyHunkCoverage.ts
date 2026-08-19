import type { HunkCoverage } from "./HunkCoverage";

const COVERAGE_RANK: Record<HunkCoverage, number> = {
	unseen: 0,
	viewed: 1,
	reviewed: 2,
};

/**
 * Applies one coverage change.
 *
 * Upgrades are monotonic — a hunk marked reviewed does not drop back to viewed
 * — but `unseen` is an explicit un-marking and always wins. That asymmetry
 * exists because coverage stopped being inferred: it used to be fed by a scroll
 * observer, where an out-of-order event could have undone deliberate work, so
 * nothing was allowed to move backwards. Now the only writer is a person
 * ticking a box, and a person who unticks it means it.
 */
export function applyHunkCoverage(
	current: HunkCoverage,
	requested: HunkCoverage,
): HunkCoverage {
	if (requested === "unseen") {
		return "unseen";
	}
	return COVERAGE_RANK[requested] > COVERAGE_RANK[current]
		? requested
		: current;
}
