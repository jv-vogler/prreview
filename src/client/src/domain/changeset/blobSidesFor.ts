import type { BlobRequest } from "@dto/BlobRequest";
import type { ChangesetRefDto, FileDiffDto } from "@dto/ChangesetDto";

export interface BlobSides {
	oldSide: BlobRequest | null;
	newSide: BlobRequest | null;
}

/** The worktree sentinel the blob endpoint accepts alongside full commit shas. */
const WORKING_REF = "WORKING";

/**
 * Which `GET /api/blob` request hydrates each side of a file diff. The
 * endpoint reads `git show <commit-sha>:<path>` (or the working tree), so the
 * refs are the changeset's resolved commits: the old side lives at `baseSha`
 * under its pre-rename path; the new side at `headSha`, or in the working
 * tree when the changeset has no head commit (worktree reviews). Added files
 * have no old side, deleted files no new side.
 */
export function blobSidesFor(
	file: FileDiffDto,
	ref: ChangesetRefDto,
): BlobSides {
	const oldSide: BlobRequest | null =
		file.status === "added"
			? null
			: { ref: ref.baseSha, path: file.oldPath ?? file.path };
	const newSide: BlobRequest | null =
		file.status === "deleted"
			? null
			: { ref: ref.headSha ?? WORKING_REF, path: file.path };
	return { oldSide, newSide };
}
