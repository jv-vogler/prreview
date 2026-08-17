import type { LineIndex } from "../changeset/LineIndex";
import type { Anchor } from "./Anchor";

/**
 * Compute where an anchor sits relative to the diff (ARCHITECTURE §6):
 * `in-diff` when every line of the range maps to a hunk in that side's
 * LineIndex, `in-file` when the range exists in the blob but not wholly in
 * hunks (a range straddling the gap between two hunks lands here too),
 * `file-level` for the 0/0 range — and, defensively, for a range outside the
 * blob's bounds, which callers are expected to clamp away beforehand.
 */
export function computePlacement(input: {
	side: Anchor["side"];
	startLine: number;
	endLine: number;
	lineIndex: LineIndex;
	blobLineCount: number;
}): Anchor["placement"] {
	const { side, startLine, endLine, lineIndex, blobLineCount } = input;
	if (startLine === 0 && endLine === 0) {
		return "file-level";
	}
	const rangeOutsideBlob =
		startLine < 1 || endLine < startLine || endLine > blobLineCount;
	if (rangeOutsideBlob) {
		return "file-level";
	}
	const sideLines = side === "old" ? lineIndex.oldLines : lineIndex.newLines;
	for (let line = startLine; line <= endLine; line++) {
		if (!sideLines.has(line)) {
			return "in-file";
		}
	}
	return "in-diff";
}
