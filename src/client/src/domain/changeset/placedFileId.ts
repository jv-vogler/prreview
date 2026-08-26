import type { DiffPlacementDto } from "@dto/ReviewDto";

export function placedFileId(placement: DiffPlacementDto): string | null {
	return placement.kind === "unplaceable" ? null : placement.fileId;
}
