import type { FileDiffDto } from "@dto/ChangesetDto";
import type { DiffCursor } from "../view/diff/DiffNavigationProvider";

export const FILE_PARAM = "file";
export const HUNK_PARAM = "hunk";

/**
 * URL ↔ cursor translation for `/diff?file=&hunk=` (TASK-051). The params
 * carry stable content-derived ids (fileId, hunkId), so a shared link still
 * lands on the same hunk after unrelated changes shift positions.
 */
export function cursorFromSearchParams(
	params: URLSearchParams,
	files: readonly FileDiffDto[],
): DiffCursor | undefined {
	const fileId = params.get(FILE_PARAM);
	if (fileId === null) {
		return undefined;
	}
	const fileIndex = files.findIndex((file) => file.id === fileId);
	if (fileIndex === -1) {
		return undefined;
	}
	const hunkId = params.get(HUNK_PARAM);
	const hunkIndex =
		hunkId === null
			? 0
			: files[fileIndex]?.hunks.findIndex((hunk) => hunk.id === hunkId);
	return {
		fileIndex,
		hunkIndex: hunkIndex === undefined || hunkIndex === -1 ? 0 : hunkIndex,
	};
}

export function searchParamsForCursor(
	current: URLSearchParams,
	files: readonly FileDiffDto[],
	cursor: DiffCursor,
): URLSearchParams {
	const next = new URLSearchParams(current);
	const file = files[cursor.fileIndex];
	if (file === undefined) {
		return next;
	}
	next.set(FILE_PARAM, file.id);
	const hunkId = file.hunks[cursor.hunkIndex]?.id;
	if (hunkId === undefined) {
		next.delete(HUNK_PARAM);
	} else {
		next.set(HUNK_PARAM, hunkId);
	}
	return next;
}
