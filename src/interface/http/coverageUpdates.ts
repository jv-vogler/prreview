import type { HunkCoverage } from "../../domain/coverage/HunkCoverage";
import type { CoverageUpdateDto } from "./dto/CoveragePut";

/**
 * The hunks whose state actually moved, which is all other tabs need to hear
 * about: monotonic upgrades are already applied, unknown hunkIds are already
 * dropped, and `unseen` is the absence of news rather than news.
 */
export function changedCoverage(
	before: Readonly<Record<string, HunkCoverage>>,
	after: Readonly<Record<string, HunkCoverage>>,
): CoverageUpdateDto[] {
	return Object.entries(after).flatMap(([hunkId, state]) =>
		state === "unseen" || state === before[hunkId] ? [] : [{ hunkId, state }],
	);
}
