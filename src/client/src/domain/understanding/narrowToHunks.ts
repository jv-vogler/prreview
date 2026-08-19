import type { FileDiffMetadata } from "@pierre/diffs";

/**
 * A parsed file diff narrowed to one topic's hunks, so a topic block shows the
 * code that serves it and nothing else.
 *
 * **Filtering the `hunks` array does not work.** This is the finding of
 * `spikes/topic-render/`, and it is the kind that costs a day if it is not
 * written down: a `Hunk` carries no text of its own. It carries
 * `additionLineIndex` / `deletionLineIndex`, which are offsets into the
 * *file-level* `additionLines` / `deletionLines` arrays. Drop hunks without
 * rebuilding those arrays and every surviving offset points at the wrong row,
 * and the renderer reports
 *
 *   DiffHunksRenderer.processDiffResult: deletionLine and additionLine are
 *   null, something is wrong
 *
 * while the block renders nothing at all. Measured over the same 8 files:
 * naive filtering gave 0/8 rendered and 32 console errors; this function gave
 * 8/8 and none.
 *
 * So narrowing re-derives the whole projection:
 *
 * 1. keep the selected hunks, in file order;
 * 2. rebuild `additionLines`/`deletionLines` from just those hunks' slices;
 * 3. re-base each hunk's two line indices into the rebuilt arrays;
 * 4. recompute `collapsedBefore`, so the dropped hunks become collapsed gaps
 *    rather than vanishing without trace;
 * 5. recompute the split/unified offsets and the file's two totals;
 * 6. set `isPartial`, which is now literally true.
 *
 * The second trap, also measured: slice by `additionCount`/`deletionCount`,
 * **never** by `additionLines`/`deletionLines`. The `*Count` fields are the
 * hunk's whole span in that version of the file, context rows included; the
 * `*Lines` fields count only the `+`/`-` rows. Slicing by the latter starves
 * the renderer of context and reproduces the same null-line error.
 */
export function narrowToHunks(
	file: FileDiffMetadata,
	hunkIndices: readonly number[],
): FileDiffMetadata {
	const ordered = [...new Set(hunkIndices)].sort((a, b) => a - b);
	const additionLines: string[] = [];
	const deletionLines: string[] = [];
	let splitLineStart = 0;
	let unifiedLineStart = 0;
	let previousOldEnd = 0;

	const hunks = ordered.flatMap((index) => {
		const hunk = file.hunks[index];
		if (hunk === undefined) {
			return [];
		}
		const additionLineIndex = additionLines.length;
		const deletionLineIndex = deletionLines.length;
		additionLines.push(
			...file.additionLines.slice(
				hunk.additionLineIndex,
				hunk.additionLineIndex + hunk.additionCount,
			),
		);
		deletionLines.push(
			...file.deletionLines.slice(
				hunk.deletionLineIndex,
				hunk.deletionLineIndex + hunk.deletionCount,
			),
		);

		// unchanged lines between the previous kept hunk and this one; the hunks
		// dropped in between collapse into this gap
		const collapsedBefore = Math.max(
			0,
			hunk.deletionStart - 1 - previousOldEnd,
		);
		previousOldEnd = hunk.deletionStart - 1 + hunk.deletionCount;

		const narrowed = {
			...hunk,
			collapsedBefore,
			additionLineIndex,
			deletionLineIndex,
			splitLineStart,
			unifiedLineStart,
		};
		splitLineStart += hunk.splitLineCount;
		unifiedLineStart += hunk.unifiedLineCount;
		return [narrowed];
	});

	return {
		...file,
		hunks,
		additionLines,
		deletionLines,
		isPartial: true,
		splitLineCount: splitLineStart,
		unifiedLineCount: unifiedLineStart,
		// content-derived and subset-specific: two topics showing the same subset
		// share cached highlights, two different subsets of one file never collide
		cacheKey: `${file.name}@${file.newObjectId ?? "none"}#${ordered.join(",")}`,
	};
}
