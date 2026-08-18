import type { FileDiffDto } from "@dto/ChangesetDto";

/**
 * Attention ordering (F6): the biggest change first, generated files last
 * (nobody reviews a lockfile line by line) — but **kept together by folder**.
 *
 * The folder rule was added because ordering purely by line count scatters a
 * change across the list: three files in `src/domain/analysis/` land at
 * positions 2, 9 and 24 with unrelated code in between, and a reader who has
 * just understood one of them has to rebuild that context to read the next. It
 * also made the file panel impossible to group visually, because "the same
 * folder" was never two rows in a row.
 *
 * Attention still decides the order, one level up: a folder is worth as much
 * as its biggest file, so the folder holding the largest change is still the
 * first thing you meet. What changed is that arriving there brings its
 * siblings with it.
 *
 * Ties break on path throughout, so the order is deterministic.
 */
export function sortFilesByAttention(
	files: readonly FileDiffDto[],
): FileDiffDto[] {
	const ordinary = files.filter((file) => !file.isGenerated);
	const generated = files.filter((file) => file.isGenerated);
	return [...groupByDirectory(ordinary), ...groupByDirectory(generated)];
}

function groupByDirectory(files: readonly FileDiffDto[]): FileDiffDto[] {
	const byDirectory = new Map<string, FileDiffDto[]>();
	for (const file of files) {
		const directory = directoryOf(file.path);
		const group = byDirectory.get(directory);
		if (group === undefined) {
			byDirectory.set(directory, [file]);
		} else {
			group.push(file);
		}
	}

	return [...byDirectory.entries()]
		.sort(([leftPath, left], [rightPath, right]) => {
			const weightDifference = heaviest(right) - heaviest(left);
			return weightDifference !== 0
				? weightDifference
				: leftPath.localeCompare(rightPath);
		})
		.flatMap(([, group]) =>
			[...group].sort((a, b) => {
				const changedLinesDifference = changedLines(b) - changedLines(a);
				return changedLinesDifference !== 0
					? changedLinesDifference
					: a.path.localeCompare(b.path);
			}),
		);
}

/** a folder is worth as much as the biggest single change inside it */
function heaviest(group: readonly FileDiffDto[]): number {
	return group.reduce((most, file) => Math.max(most, changedLines(file)), 0);
}

export function directoryOf(path: string): string {
	const lastSlash = path.lastIndexOf("/");
	return lastSlash === -1 ? "" : path.slice(0, lastSlash);
}

function changedLines(file: FileDiffDto): number {
	return file.additions + file.deletions;
}
