const ID_PREFIX = "finding-";

/**
 * What a pass carries so its findings can be named: the id of each finding
 * in `findings` order, and the counter the next new one is minted from.
 * Both are absent on every pass written before ids became data — those
 * findings are named by position, which is what the fallbacks below restore.
 */
export interface StoredFindingIds {
	findingIds?: readonly string[];
}

/**
 * The id a finding's position gets when the pass names none of its own. It
 * is also the id the very first pass mints, so a pass written before ids
 * existed and one written after agree on what to call `findings[0]` — which
 * is what lets an edit, a dismissal or a publish record survive the change
 * with no rewrite.
 */
export function reviewCommentId(index: number): string {
	return `${ID_PREFIX}${index}`;
}

/** The id of the finding at `index`: the pass's own, or its position's. */
export function commentIdAt(stored: StoredFindingIds, index: number): string {
	return stored.findingIds?.[index] ?? reviewCommentId(index);
}

/**
 * The inverse of `commentIdAt`; null when this pass has no such finding.
 * A position is only accepted when the pass names no id of its own there:
 * once a pass carries ids, they are the only truth about which finding is
 * which, and reading `finding-1` as "the second one" would reattach the
 * reader's edit to a finding that never had it.
 */
export function findingIndexForComment(
	stored: StoredFindingIds,
	commentId: string,
): number | null {
	const named = stored.findingIds?.indexOf(commentId) ?? -1;
	if (named >= 0) {
		return named;
	}
	const positional = positionOf(commentId);
	if (positional === null || stored.findingIds?.[positional] !== undefined) {
		return null;
	}
	return positional;
}

function positionOf(commentId: string): number | null {
	if (!commentId.startsWith(ID_PREFIX)) {
		return null;
	}
	const rest = commentId.slice(ID_PREFIX.length);
	if (!/^\d+$/.test(rest)) {
		return null;
	}
	return Number(rest);
}
