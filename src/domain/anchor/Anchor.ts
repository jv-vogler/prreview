/**
 * How a note stays glued to the right lines (ARCHITECTURE §6). The snapshot
 * carries enough of the anchored content — normalized target lines, their
 * hash, and up to three context lines each side — for the six-step
 * re-anchoring algorithm to find where the lines went after an edit.
 * `startLine === 0 && endLine === 0` means the anchor is file-level.
 */
export interface Anchor {
	fileId: string;
	path: string;
	side: "old" | "new";
	startLine: number;
	endLine: number;
	/** computed by the server, never agent-supplied */
	placement: "in-diff" | "in-file" | "file-level";
	snapshot: {
		blobOid: string;
		/** normalized (see normalizeLine) */
		targetLines: string[];
		lineHash: string;
		/** up to 3, normalized, in file order */
		contextBefore: string[];
		/** up to 3, normalized, in file order */
		contextAfter: string[];
	};
}

/**
 * Outcome of the last re-anchoring pass: `anchored` (steps 1–2, exact),
 * `moved` (steps 3–4, found elsewhere), `fuzzy` (step 5, found edited),
 * `orphaned` (step 6, the code is gone; the anchor is kept as-is).
 */
export type AnchorStatus = "anchored" | "moved" | "fuzzy" | "orphaned";

/**
 * What the model emits (ARCHITECTURE §7's output schemas). The server
 * converts it into a full Anchor by capturing the snapshot and computing
 * `placement`.
 */
export interface AgentAnchor {
	path: string;
	side: "old" | "new";
	startLine: number;
	endLine: number;
}
