import type { FileDiffDto } from "@dto/ChangesetDto";
import type { TopicDto } from "@dto/TopicDto";

/**
 * How much of the whole change each topic covers, as a fraction in [0, 1], one
 * per topic in topic order — F4's relative sizing, which is the point of
 * showing topics at all ("the real behaviour change is these 40 lines; these
 * 900 are rename fallout").
 *
 * **The denominator is the changeset's total changed lines, not the sum over
 * topics.** Topics are many-to-many with hunks and do not partition the diff,
 * so normalizing by the sum over topics double-counts every shared hunk and
 * shrinks every bar. These fractions therefore **do not sum to 1**, which is
 * correct: each bar reads independently as "covers ~18% of the change".
 *
 * The numerator is the deduplicated union of the topic's hunks, so naming a
 * hunk twice — or naming a file both wholly and by hunk — counts it once.
 *
 * Deliberately a client-side twin of the server's `topicCoverageFractions`: the
 * browser may import the wire contract (`@dto`) and nothing else of the server
 * (ARCHITECTURE §2), and both sides need the same arithmetic. The two are
 * pinned to shared vectors in `test/vectors/topicSizing.json`.
 */
export function topicCoverageFractions(
	topics: readonly TopicDto[],
	files: readonly FileDiffDto[],
): number[] {
	const filesByPath = new Map(files.map((file) => [file.path, file]));
	const changesetTotal = files.reduce(
		(sum, file) => sum + file.additions + file.deletions,
		0,
	);
	if (changesetTotal === 0) {
		return topics.map(() => 0);
	}
	return topics.map((topic) =>
		Math.min(1, topicChangedLines(topic, filesByPath) / changesetTotal),
	);
}

/**
 * The hunks no topic accounts for — the check that catches a comprehension pass
 * which grouped the obvious two things and ignored the other thirty files. The
 * tab says so rather than implying the topics are exhaustive.
 */
export function uncoveredHunks(
	topics: readonly TopicDto[],
	files: readonly FileDiffDto[],
): { path: string; hunkId: string }[] {
	const filesByPath = new Map(files.map((file) => [file.path, file]));
	const coveredWholeFiles = new Set<string>();
	const coveredHunkKeys = new Set<string>();

	for (const topic of topics) {
		const { wholeFilePaths, hunkIdsByPath } = resolveRefs(
			topic.refs,
			filesByPath,
		);
		for (const path of wholeFilePaths) {
			coveredWholeFiles.add(path);
		}
		for (const [path, hunkIds] of hunkIdsByPath) {
			for (const hunkId of hunkIds) {
				coveredHunkKeys.add(`${path} ${hunkId}`);
			}
		}
	}

	const uncovered: { path: string; hunkId: string }[] = [];
	for (const file of files) {
		if (coveredWholeFiles.has(file.path)) {
			continue;
		}
		for (const hunk of file.hunks) {
			if (!coveredHunkKeys.has(`${file.path} ${hunk.id}`)) {
				uncovered.push({ path: file.path, hunkId: hunk.id });
			}
		}
	}
	return uncovered;
}

function topicChangedLines(
	topic: TopicDto,
	filesByPath: Map<string, FileDiffDto>,
): number {
	const { wholeFilePaths, hunkIdsByPath } = resolveRefs(
		topic.refs,
		filesByPath,
	);

	let total = 0;
	for (const path of wholeFilePaths) {
		const file = filesByPath.get(path);
		if (file !== undefined) {
			total += file.additions + file.deletions;
		}
	}
	for (const [path, hunkIds] of hunkIdsByPath) {
		if (wholeFilePaths.has(path)) {
			continue;
		}
		const file = filesByPath.get(path);
		if (file === undefined) {
			continue;
		}
		for (const hunk of file.hunks) {
			if (hunkIds.has(hunk.id)) {
				total += hunk.lines.filter((line) => line.type !== "context").length;
			}
		}
	}
	return total;
}

/** shared so sizing and the uncovered derivation cannot disagree about a ref */
function resolveRefs(
	refs: readonly TopicDto["refs"][number][],
	filesByPath: Map<string, FileDiffDto>,
): { wholeFilePaths: Set<string>; hunkIdsByPath: Map<string, Set<string>> } {
	const wholeFilePaths = new Set<string>();
	const hunkIdsByPath = new Map<string, Set<string>>();

	for (const ref of refs) {
		const file = filesByPath.get(ref.path);
		if (file === undefined) {
			continue;
		}
		if (ref.hunkIds.length === 0) {
			wholeFilePaths.add(ref.path);
			continue;
		}
		const wanted = new Set(ref.hunkIds);
		const named = file.hunks.filter((hunk) => wanted.has(hunk.id));
		// Stale ids on a known path fall back to the whole file: ids go stale when
		// a later round re-hashes a hunk, and rendering "0%" beside a file the
		// topic visibly contains is a false claim.
		if (named.length === 0) {
			wholeFilePaths.add(ref.path);
			continue;
		}
		const existing = hunkIdsByPath.get(ref.path) ?? new Set<string>();
		for (const hunk of named) {
			existing.add(hunk.id);
		}
		hunkIdsByPath.set(ref.path, existing);
	}
	return { wholeFilePaths, hunkIdsByPath };
}
