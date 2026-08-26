import type { BlobRequest } from "@dto/BlobRequest";
import type { ChangesetRefDto, FileDiffDto } from "@dto/ChangesetDto";

export interface BlobSides {
	oldSide: BlobRequest | null;
	newSide: BlobRequest | null;
}

const WORKING_REF = "WORKING";

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
