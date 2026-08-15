import type { FileDiffDto } from "@dto/ChangesetDto";
import type { CoverageSummaryDto } from "@dto/CoverageSummaryDto";
import type { HunkCoverage } from "./HunkCoverage";

const FULLY_COVERED_PERCENT = 100;

/**
 * Percent math mirroring the server's semantics exactly: a hunk counts once
 * it is viewed or reviewed; a file with no hunks (binary, mode-only) has
 * nothing left to read, reports fully covered, and contributes no hunks to
 * the total; percentages are unrounded floats — rounding is presentation.
 *
 * The M1 view renders the server's summaries verbatim (REQ-007); this mirror
 * exists for local reasoning over the client's own hunk record.
 */
export function computeCoverage(
	files: readonly FileDiffDto[],
	hunkStates: Readonly<Record<string, HunkCoverage>>,
): CoverageSummaryDto {
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
