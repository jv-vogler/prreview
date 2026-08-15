import { createHash } from "node:crypto";
import type { DiffLine } from "./DiffLine";

const FILE_ID_PREFIX = "f_";
const FILE_ID_HEX_LENGTH = 12;
// NUL can never appear inside a git path, so the two sides cannot bleed into each other.
const PATH_JOIN_SEPARATOR = "\0";
const HUNK_LINE_SEPARATOR = "\n";
const DUP_INDEX_SEPARATOR = "-";

function sha256Hex(input: string): string {
	return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * fileId = "f_" + sha256(oldPath + "\0" + path).slice(0, 12).
 *
 * A hash over both sides rather than the path alone, because a changeset that
 * deletes A and renames B → A collides on any natural key (ARCHITECTURE §5).
 * When there is no old side (no rename/copy), the path stands in for it.
 */
export function fileIdFor(paths: { path: string; oldPath?: string }): string {
	const oldSide = paths.oldPath ?? paths.path;
	const digest = sha256Hex(oldSide + PATH_JOIN_SEPARATOR + paths.path);
	return FILE_ID_PREFIX + digest.slice(0, FILE_ID_HEX_LENGTH);
}

/**
 * Content-derived, position-independent hunk identity (ARCHITECTURE §5):
 * sha256 over the hunk's lines joined as `type[0] + content`. Position is
 * deliberately excluded so coverage carries across rounds when content is
 * unchanged. Line content can never contain "\n", so the join is unambiguous.
 */
export function hunkIdFor(lines: readonly DiffLine[]): string {
	const body = lines
		.map((line) => line.type[0] + line.content)
		.join(HUNK_LINE_SEPARATOR);
	return sha256Hex(body);
}

/**
 * Ids for all hunks of one file, in order. Identical hunk bodies within the
 * file get a dupIndex suffix ("<hash>-1", "<hash>-2", …); the first occurrence
 * keeps the bare hash so the common case stays clean and carries naturally.
 */
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
