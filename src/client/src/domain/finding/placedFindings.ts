import type { AnchorSideDto, ReviewFindingDto } from "@dto/ReviewDto";

/**
 * Where one comment's gutter marker goes on the rendered diff — every
 * comment whose placement is `exact` or `clamped` gets one; `unplaceable`
 * comments never appear here, only in the sidebar (REQ-010).
 */
export interface PlacedFinding {
	fileId: string;
	side: AnchorSideDto;
	line: number;
	findingId: string;
}

export function placedFindings(
	findings: readonly ReviewFindingDto[],
): PlacedFinding[] {
	const placed: PlacedFinding[] = [];
	for (const finding of findings) {
		if (finding.placement.kind === "unplaceable") {
			continue;
		}
		placed.push({
			fileId: finding.placement.fileId,
			side: finding.placement.side,
			line: finding.placement.line,
			findingId: finding.id,
		});
	}
	return placed;
}

/** One rendered diff line can carry more than one comment; they share a marker. */
export interface AnnotationGroup {
	fileId: string;
	side: AnchorSideDto;
	line: number;
	findingIds: string[];
}

export function groupPlacedFindings(
	placed: readonly PlacedFinding[],
): AnnotationGroup[] {
	const groups = new Map<string, AnnotationGroup>();
	for (const item of placed) {
		const key = `${item.fileId}:${item.side}:${item.line}`;
		const existing = groups.get(key);
		if (existing === undefined) {
			groups.set(key, {
				fileId: item.fileId,
				side: item.side,
				line: item.line,
				findingIds: [item.findingId],
			});
		} else {
			existing.findingIds.push(item.findingId);
		}
	}
	return [...groups.values()];
}
