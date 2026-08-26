import type { DiffPlacementDto } from "@dto/ReviewDto";
import { useCallback, useEffect, useState } from "react";
import { placedFileId } from "../../domain/changeset/placedFileId";

export interface FileFolding {
	foldedFileIds: ReadonlySet<string>;
	viewedFileIds: ReadonlySet<string>;
	toggleFold(fileId: string): void;
	toggleViewed(fileId: string): void;
	revealPlacement(placement: DiffPlacementDto, scroll: () => void): void;
}

export function useFileFolding(): FileFolding {
	const [foldedFileIds, setFoldedFileIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [viewedFileIds, setViewedFileIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [pendingScroll, setPendingScroll] = useState<(() => void) | null>(null);

	useEffect(() => {
		if (pendingScroll === null) {
			return;
		}
		const frame = requestAnimationFrame(() => {
			setPendingScroll(null);
			pendingScroll();
		});
		return () => cancelAnimationFrame(frame);
	}, [pendingScroll]);

	const toggleFold = useCallback((fileId: string) => {
		setFoldedFileIds((current) => toggled(current, fileId));
	}, []);

	const toggleViewed = useCallback(
		(fileId: string) => {
			const becomingViewed = !viewedFileIds.has(fileId);
			setViewedFileIds((current) => toggled(current, fileId));
			setFoldedFileIds((current) =>
				current.has(fileId) === becomingViewed
					? current
					: toggled(current, fileId),
			);
		},
		[viewedFileIds],
	);

	const revealPlacement = useCallback(
		(placement: DiffPlacementDto, scroll: () => void) => {
			const fileId = placedFileId(placement);
			if (fileId === null) {
				return;
			}
			if (!foldedFileIds.has(fileId)) {
				scroll();
				return;
			}
			setFoldedFileIds((current) => toggled(current, fileId));
			setPendingScroll(() => scroll);
		},
		[foldedFileIds],
	);

	return {
		foldedFileIds,
		viewedFileIds,
		toggleFold,
		toggleViewed,
		revealPlacement,
	};
}

function toggled(
	current: ReadonlySet<string>,
	id: string,
): ReadonlySet<string> {
	const next = new Set(current);
	if (!next.delete(id)) {
		next.add(id);
	}
	return next;
}
