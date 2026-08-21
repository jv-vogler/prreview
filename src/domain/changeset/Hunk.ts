import type { DiffLine } from "./DiffLine";

export interface Hunk {
	id: string;
	/** function context preserved verbatim */
	header: string;
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: DiffLine[];
}
