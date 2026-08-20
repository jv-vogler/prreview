import type { FileDiffDto } from "@dto/ChangesetDto";
import type { DiffCursor } from "../view/diff/DiffNavigationProvider";

export const FILE_PARAM = "file";
export const HUNK_PARAM = "hunk";
/** which finding the reader arrived to look at, from a link on the comments tab */
export const FINDING_PARAM = "finding";

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

/**
 * A link into the diff at one file, optionally at one hunk (TASK-053): the
 * Understanding tab's topics and its entry point both land through here, so
 * "where a file lives in the URL" is decided in exactly one module.
 */
export function diffPathFor(fileId: string, hunkId?: string | null): string {
	const params = new URLSearchParams({ [FILE_PARAM]: fileId });
	if (hunkId !== undefined && hunkId !== null) {
		params.set(HUNK_PARAM, hunkId);
	}
	return `/diff?${params.toString()}`;
}

/**
 * The finding a link asked to land on, if any.
 *
 * The parameter was being written by the comments tab and read by nobody, so
 * following a comment into the diff selected nothing when it arrived. Selection
 * across the two surfaces is the entire point of splitting the list from the
 * balloons.
 */
export function findingFromSearchParams(
	params: URLSearchParams,
): string | null {
	return params.get(FINDING_PARAM);
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
