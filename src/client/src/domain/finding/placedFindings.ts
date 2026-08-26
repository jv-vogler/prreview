import type { AnchorSideDto, ReviewFindingDto } from "@dto/ReviewDto";

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

export interface FindingGroup {
	fileId: string;
	side: AnchorSideDto;
	line: number;
	findingIds: string[];
}

export function groupPlacedFindings(
	placed: readonly PlacedFinding[],
): FindingGroup[] {
	const groups = new Map<string, FindingGroup>();
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
