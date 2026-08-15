import type { FileDiffDto } from "@dto/ChangesetDto";

/**
 * Attention ordering (F6), M1 rules: most changed lines first, generated
 * files last regardless of size (nobody reviews a lockfile line by line).
 * Ties break on path so the order is deterministic. Risk scores join the
 * sort key in M2.
 */
export function sortFilesByAttention(
	files: readonly FileDiffDto[],
): FileDiffDto[] {
	return [...files].sort((a, b) => {
		if (a.isGenerated !== b.isGenerated) {
			return a.isGenerated ? 1 : -1;
		}
		const changedLinesDifference = changedLines(b) - changedLines(a);
		if (changedLinesDifference !== 0) {
			return changedLinesDifference;
		}
		return a.path.localeCompare(b.path);
	});
}

function changedLines(file: FileDiffDto): number {
	return file.additions + file.deletions;
}
