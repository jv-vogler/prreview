import type { CommentAnchorSideDto, ExplanationDto } from "@dto/ReviewDto";

/**
 * Where one explanation's balloon goes on the rendered diff. Unplaceable
 * explanations never appear here: unlike a finding, an explanation is about
 * a line of the change, so with no line to sit next to it has nothing to
 * explain (the DTO still carries it, counted, never silently lost).
 */
export interface PlacedExplanation {
	fileId: string;
	side: CommentAnchorSideDto;
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

/** One rendered diff line can carry several explanations; they share a slot. */
export interface ExplanationGroup {
	fileId: string;
	side: CommentAnchorSideDto;
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
