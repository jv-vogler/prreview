import type { FileDiff } from "../changeset/FileDiff";
import type { HunkCoverage } from "./HunkCoverage";

/**
 * Coverage carry-over for a changeset refresh (ARCHITECTURE §12): a plain
 * intersection over hunkIds. Hunks whose content survived into the new round
 * keep their state, removed hunks drop out, and new hunks start unseen by
 * being absent — so the total honestly drops.
 */
export function carryCoverage(
	previous: Readonly<Record<string, HunkCoverage>>,
	nextRoundFiles: readonly FileDiff[],
): Record<string, HunkCoverage> {
	const survivingHunkIds = new Set(
		nextRoundFiles.flatMap((file) => file.hunks.map((hunk) => hunk.id)),
	);
	const carried: Record<string, HunkCoverage> = {};
	for (const [hunkId, state] of Object.entries(previous)) {
		if (survivingHunkIds.has(hunkId)) {
			carried[hunkId] = state;
		}
	}
	return carried;
}
