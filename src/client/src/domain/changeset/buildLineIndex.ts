import type { FileDiffDto } from "@dto/ChangesetDto";

export interface FileLineIndex {
	/** old-side line number → index into `file.hunks` */
	oldLines: Map<number, number>;
	/** new-side line number → index into `file.hunks` */
	newLines: Map<number, number>;
}

/**
 * Line-number → hunk lookup for one file, mirroring the server's LineIndex:
 * file line numbers are stable coordinates (unlike rendered row indices,
 * which shift when context expands), so the view can map any visible line
 * back to the hunk it belongs to.
 */
export function buildLineIndex(file: FileDiffDto): FileLineIndex {
	const oldLines = new Map<number, number>();
	const newLines = new Map<number, number>();
	file.hunks.forEach((hunk, hunkIndex) => {
		for (const line of hunk.lines) {
			if (line.oldLine !== undefined) {
				oldLines.set(line.oldLine, hunkIndex);
			}
			if (line.newLine !== undefined) {
				newLines.set(line.newLine, hunkIndex);
			}
		}
	});
	return { oldLines, newLines };
}
