import { createHash } from "node:crypto";
import type { DiffLine } from "./DiffLine";

const FILE_ID_PREFIX = "f_";
const FILE_ID_HEX_LENGTH = 12;

const PATH_JOIN_SEPARATOR = "\0";
const HUNK_LINE_SEPARATOR = "\n";
const DUP_INDEX_SEPARATOR = "-";

function sha256Hex(input: string): string {
	return createHash("sha256").update(input, "utf8").digest("hex");
}

export function fileIdFor(paths: { path: string; oldPath?: string }): string {
	const oldSide = paths.oldPath ?? paths.path;
	const digest = sha256Hex(oldSide + PATH_JOIN_SEPARATOR + paths.path);
	return FILE_ID_PREFIX + digest.slice(0, FILE_ID_HEX_LENGTH);
}

export function hunkIdFor(lines: readonly DiffLine[]): string {
	const body = lines
		.map((line) => line.type[0] + line.content)
		.join(HUNK_LINE_SEPARATOR);
	return sha256Hex(body);
}

export function assignHunkIds(
	hunkBodies: readonly (readonly DiffLine[])[],
): string[] {
	const occurrencesSeen = new Map<string, number>();
	return hunkBodies.map((lines) => {
		const contentId = hunkIdFor(lines);
		const priorOccurrences = occurrencesSeen.get(contentId) ?? 0;
		occurrencesSeen.set(contentId, priorOccurrences + 1);
		if (priorOccurrences === 0) {
			return contentId;
		}
		return contentId + DUP_INDEX_SEPARATOR + String(priorOccurrences);
	});
}
