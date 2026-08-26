const ID_PREFIX = "finding-";

export interface StoredFindingIds {
	findingIds?: readonly string[];
}

export function findingId(index: number): string {
	return `${ID_PREFIX}${index}`;
}

export function findingIdAt(stored: StoredFindingIds, index: number): string {
	return stored.findingIds?.[index] ?? findingId(index);
}

export function findingIndexFor(
	stored: StoredFindingIds,
	findingId: string,
): number | null {
	const named = stored.findingIds?.indexOf(findingId) ?? -1;
	if (named >= 0) {
		return named;
	}
	const positional = positionOf(findingId);
	if (positional === null || stored.findingIds?.[positional] !== undefined) {
		return null;
	}
	return positional;
}

function positionOf(findingId: string): number | null {
	if (!findingId.startsWith(ID_PREFIX)) {
		return null;
	}
	const rest = findingId.slice(ID_PREFIX.length);
	if (!/^\d+$/.test(rest)) {
		return null;
	}
	return Number(rest);
}
