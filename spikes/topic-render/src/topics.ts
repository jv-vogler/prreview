import type { FileDiffMetadata } from "@pierre/diffs";

/**
 * The Understanding tab's shape, reduced to what the render question needs.
 *
 * A topic is a plain-language unit of intent carrying a set of hunk
 * references. Topic↔hunk is **many-to-many**: the same hunk may appear under
 * two topics, so topics are not a partition of the diff and a block's identity
 * is composite (`${topicId}:${fileName}`), never the file or hunk alone.
 */
export interface TopicBlock {
	fileName: string;
	/** indices into the parsed file's `hunks`, the subset this topic covers */
	hunkIndices: number[];
}

export interface Topic {
	id: string;
	title: string;
	summary: string;
	blocks: TopicBlock[];
}

/**
 * Builds a deliberately hostile-but-realistic topic set over the fixture:
 *
 * - ~48 blocks total, which is the instance count the design is unsure about;
 * - blocks spread across many files rather than clustered in one;
 * - **overlap on purpose** — some hunks appear under two topics, because that
 *   is the case the many-to-many model exists for and the case a naive
 *   `key={hunkId}` implementation breaks on.
 *
 * Deterministic: no randomness, so a re-run compares against the same numbers.
 */
export function buildTopics(files: FileDiffMetadata[]): Topic[] {
	const TOPIC_COUNT = 8;
	const BLOCKS_PER_TOPIC = 6;
	const topics: Topic[] = [];

	for (let topicIndex = 0; topicIndex < TOPIC_COUNT; topicIndex++) {
		const blocks: TopicBlock[] = [];
		for (let blockIndex = 0; blockIndex < BLOCKS_PER_TOPIC; blockIndex++) {
			// stride through the files so a topic spans the changeset
			const fileIndex = (topicIndex * BLOCKS_PER_TOPIC + blockIndex) %
				files.length;
			const file = files[fileIndex];
			if (file === undefined) {
				continue;
			}
			const hunkCount = file.hunks.length;
			// each block takes 2-3 of the file's hunks, offset by the topic, so
			// consecutive topics touching the same file overlap on one hunk
			const first = (topicIndex + blockIndex) % hunkCount;
			const hunkIndices = [first, (first + 1) % hunkCount];
			if (blockIndex % 2 === 0) {
				hunkIndices.push((first + 2) % hunkCount);
			}
			blocks.push({
				fileName: file.name,
				hunkIndices: [...new Set(hunkIndices)].sort((a, b) => a - b),
			});
		}
		topics.push({
			id: `topic-${topicIndex + 1}`,
			title: TOPIC_TITLES[topicIndex] ?? `Topic ${topicIndex + 1}`,
			summary:
				"A plain-language description of one unit of intent, held to the " +
				"length the schema will enforce so the measured layout is honest.",
			blocks,
		});
	}
	return topics;
}

const TOPIC_TITLES = [
	"Reshape the session store's write path",
	"Add the coverage projection",
	"Split the anchor resolver from its cache",
	"Thread cancellation through the run manager",
	"Replace the ad-hoc SSE buffer",
	"Tighten the changeset id derivation",
	"Move the diff parser off the main thread",
	"Retire the legacy walkthrough shape",
];

/** the composite identity: never the hunk alone (many-to-many) */
export function blockKey(topicId: string, fileName: string): string {
	return `${topicId}:${fileName}`;
}

/**
 * A `FileDiffMetadata` narrowed to one topic's hunks.
 *
 * **Filtering `hunks` alone does not work** and this is the spike's central
 * finding. A `Hunk` does not carry its own text: it carries
 * `additionLineIndex` / `deletionLineIndex`, which are offsets into the
 * *file-level* `additionLines` / `deletionLines` arrays. Drop hunks without
 * rebuilding those arrays and every surviving index points at the wrong row,
 * which the renderer reports as
 *
 *   DiffHunksRenderer.processDiffResult: deletionLine and additionLine are
 *   null, something is wrong
 *
 * and the block renders nothing. Measured: naive filtering produced 0/8
 * rendered files and 32 errors; the rebuild below produces 8/8 and none.
 *
 * So narrowing means re-deriving the whole projection:
 *
 * 1. keep the selected hunks, in file order;
 * 2. rebuild `additionLines`/`deletionLines` from just those hunks' slices;
 * 3. re-base each hunk's two line indices into the rebuilt arrays;
 * 4. recompute `collapsedBefore` so the dropped hunks become collapsed gaps;
 * 5. recompute the split/unified line offsets and totals;
 * 6. set `isPartial`, which is precisely what it means — the arrays are no
 *    longer the whole file.
 *
 * `cacheKey` includes the subset, so two topics showing the *same* subset
 * share cached highlights while two subsets of one file never collide.
 */
export function narrowToHunks(
	file: FileDiffMetadata,
	hunkIndices: number[],
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
		// `additionCount`/`deletionCount`, not `additionLines`/`deletionLines`:
		// the former is the hunk's total span in that version of the file
		// (context rows included), the latter counts only the +/- rows. Slicing
		// by the latter leaves the renderer short of context and it reports the
		// null-line error.
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

		// unchanged lines between the previous kept hunk and this one — the
		// dropped hunks collapse into this gap rather than vanishing silently
		const collapsedBefore = Math.max(0, hunk.deletionStart - 1 - previousOldEnd);
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
		cacheKey: `${file.name}@${file.newObjectId ?? "none"}#${ordered.join(",")}`,
	};
}
