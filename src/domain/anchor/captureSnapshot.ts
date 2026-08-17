import { createHash } from "node:crypto";
import type { Anchor } from "./Anchor";
import { normalizeLine } from "./normalizeLine";

const CONTEXT_LINES = 3;
const LINE_JOIN_SEPARATOR = "\n";

function sha256Hex(input: string): string {
	return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Capture an anchor snapshot from a blob's lines (ARCHITECTURE §6). Line
 * numbers are 1-based; a 0/0 range is a file-level anchor and captures an
 * empty target with no context. Everything stored is normalized, and
 * `lineHash` is the sha256 of the normalized target lines, so comparisons
 * during re-anchoring never re-normalize the snapshot side.
 */
export function captureSnapshot(
	lines: string[],
	startLine: number,
	endLine: number,
	blobOid: string,
): Anchor["snapshot"] {
	const isFileLevel = startLine === 0 && endLine === 0;
	const targetLines = isFileLevel
		? []
		: lines.slice(startLine - 1, endLine).map(normalizeLine);
	const contextBefore = isFileLevel
		? []
		: lines
				.slice(Math.max(0, startLine - 1 - CONTEXT_LINES), startLine - 1)
				.map(normalizeLine);
	const contextAfter = isFileLevel
		? []
		: lines.slice(endLine, endLine + CONTEXT_LINES).map(normalizeLine);
	return {
		blobOid,
		targetLines,
		lineHash: sha256Hex(targetLines.join(LINE_JOIN_SEPARATOR)),
		contextBefore,
		contextAfter,
	};
}
