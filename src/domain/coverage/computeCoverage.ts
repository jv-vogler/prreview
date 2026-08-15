import type { FileDiff } from "../changeset/FileDiff";
import type { HunkCoverage } from "./HunkCoverage";

export interface CoverageSummary {
	/** 0–100 over every hunk in the changeset */
	total: number;
	/** fileId → 0–100 */
	byFile: Record<string, number>;
}

const FULLY_COVERED_PERCENT = 100;

/**
 * Percent of hunks that have been seen (viewed or reviewed), per file and in
 * total. A hunk absent from the states record is unseen. A file with no hunks
 * (binary, mode-only) has nothing left to read and counts as fully covered;
 * such files contribute no hunks to the total.
 */
export function computeCoverage(
	files: readonly FileDiff[],
	hunkStates: Readonly<Record<string, HunkCoverage>>,
): CoverageSummary {
	const byFile: Record<string, number> = {};
	let totalHunks = 0;
	let totalSeen = 0;

	for (const file of files) {
		const seen = file.hunks.filter(
			(hunk) => (hunkStates[hunk.id] ?? "unseen") !== "unseen",
		).length;
		totalHunks += file.hunks.length;
		totalSeen += seen;
		byFile[file.id] =
			file.hunks.length === 0
				? FULLY_COVERED_PERCENT
				: (seen / file.hunks.length) * FULLY_COVERED_PERCENT;
	}

	return {
		total:
			totalHunks === 0
				? FULLY_COVERED_PERCENT
				: (totalSeen / totalHunks) * FULLY_COVERED_PERCENT,
		byFile,
	};
}
