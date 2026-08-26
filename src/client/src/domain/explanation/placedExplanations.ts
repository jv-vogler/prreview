import type { AnchorSideDto, ExplanationDto } from "@dto/ReviewDto";

export interface PlacedExplanation {
	fileId: string;
	side: AnchorSideDto;
	line: number;
	explanationId: string;
}

export function placedExplanations(
	explanations: readonly ExplanationDto[],
): PlacedExplanation[] {
	const placed: PlacedExplanation[] = [];
	for (const explanation of explanations) {
		if (explanation.placement.kind === "unplaceable") {
			continue;
		}
		placed.push({
			fileId: explanation.placement.fileId,
			side: explanation.placement.side,
			line: explanation.placement.line,
			explanationId: explanation.id,
		});
	}
	return placed;
}

export interface ExplanationGroup {
	fileId: string;
	side: AnchorSideDto;
	line: number;
	explanationIds: string[];
}

export function groupPlacedExplanations(
	placed: readonly PlacedExplanation[],
): ExplanationGroup[] {
	const groups = new Map<string, ExplanationGroup>();
	for (const item of placed) {
		const key = `${item.fileId}:${item.side}:${item.line}`;
		const existing = groups.get(key);
		if (existing === undefined) {
			groups.set(key, {
				fileId: item.fileId,
				side: item.side,
				line: item.line,
				explanationIds: [item.explanationId],
			});
		} else {
			existing.explanationIds.push(item.explanationId);
		}
	}
	return [...groups.values()];
}
