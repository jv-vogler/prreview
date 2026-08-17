import type { FileDiffDto } from "@dto/ChangesetDto";
import type { ChatMessageContextDto } from "@dto/ChatMessageDto";
import type { DiffPosition } from "../changeset/DiffPosition";

/**
 * What frames the next question (F8's context-awareness): the file and hunk the
 * reader is on. It comes from the client because the server does not watch the
 * viewport (ARCHITECTURE §8) — the browser is the only thing that knows where
 * the reader is looking.
 *
 * A file with no hunk under the cursor still frames the question by path: "this
 * file" is real context, and claiming a hunk that is not there would not be.
 */
export function chatContextFromCursor(
	files: readonly FileDiffDto[],
	cursor: DiffPosition,
): ChatMessageContextDto {
	const file = files[cursor.fileIndex];
	if (file === undefined) {
		return {};
	}
	const hunkId = file.hunks[cursor.hunkIndex]?.id;
	return hunkId === undefined
		? { file: file.path }
		: { file: file.path, hunkId };
}
