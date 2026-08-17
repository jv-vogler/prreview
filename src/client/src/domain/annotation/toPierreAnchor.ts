import type { AnchorDto } from "@dto/AnchorDto";

/**
 * Where the diff renderer puts a note: the side of the split view and the row
 * to hang it under. Declared structurally rather than imported, because
 * `DiffWorkspace.tsx` is the only module allowed to import @pierre/diffs —
 * this shape satisfies its `DiffLineAnnotation`.
 */
export interface PierreAnchor {
	side: "additions" | "deletions";
	lineNumber: number;
}

/** the renderer's own convention for "above the first row of the file" */
const FILE_LEVEL_LINE = 0;

/**
 * ARCHITECTURE §6's first consumer: an anchor resolved by the server becomes
 * renderer coordinates, and nothing more is decided here. A note hangs under
 * the LAST line of its range (`endLine`) so a multi-line note does not push
 * apart the lines it is about, and a file-level note uses line 0, which the
 * renderer places above the first row of the side it names.
 */
export function toPierreAnchor(anchor: AnchorDto): PierreAnchor {
	const side = anchor.side === "old" ? "deletions" : "additions";
	if (anchor.placement === "file-level") {
		return { side, lineNumber: FILE_LEVEL_LINE };
	}
	return { side, lineNumber: anchor.endLine };
}
