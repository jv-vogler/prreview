import type { FileDiff } from "./FileDiff";

/**
 * Answers "is this line actually part of the diff?" for one file, mapping a
 * line number on either side to the id of the hunk containing it. Derived
 * from the IR rather than stored, because the IR snapshot is plain JSON and
 * Maps do not survive it.
 */
export interface LineIndex {
	oldLines: Map<number, string>;
	newLines: Map<number, string>;
}

export function buildLineIndex(file: FileDiff): LineIndex {
	const oldLines = new Map<number, string>();
	const newLines = new Map<number, string>();
	for (const hunk of file.hunks) {
		for (const line of hunk.lines) {
			if (line.oldLine !== undefined) {
				oldLines.set(line.oldLine, hunk.id);
			}
			if (line.newLine !== undefined) {
				newLines.set(line.newLine, hunk.id);
			}
		}
	}
	return { oldLines, newLines };
}
