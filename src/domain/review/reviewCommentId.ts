const ID_PREFIX = "finding-";

/**
 * The stable id a finding's position in the pass gets on the wire
 * (TASK-041). Positional rather than content-derived: `applyCommentOps`
 * (TASK-046) never reorders or removes findings, only marks them, so a
 * finding's index — and therefore its id — never moves for the life of a
 * pass.
 */
export function reviewCommentId(index: number): string {
	return `${ID_PREFIX}${index}`;
}

/** The inverse of `reviewCommentId`; null when `commentId` is not one of ours. */
export function findingIndexForCommentId(commentId: string): number | null {
	if (!commentId.startsWith(ID_PREFIX)) {
		return null;
	}
	const rest = commentId.slice(ID_PREFIX.length);
	if (!/^\d+$/.test(rest)) {
		return null;
	}
	return Number(rest);
}
