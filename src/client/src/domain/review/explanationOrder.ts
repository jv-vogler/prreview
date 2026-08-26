import type { ExplanationDto } from "@dto/ReviewDto";

/**
 * Explanations in the order the reader will meet them: the diff's own file
 * order, then line order inside a file.
 *
 * The agent writes them in whatever order it thought of them, which is an
 * order nobody else can follow. Sorted here rather than in the panel, so the
 * sidebar's read-through, the topic color slots (assigned by first mention)
 * and the scroll down the diff all tell the same story in the same sequence.
 *
 * An explanation whose file is not in the diff at all sorts last: it cannot
 * be met by scrolling, so it belongs after everything that can.
 */
export function sortExplanationsByDiff(
	explanations: readonly ExplanationDto[],
	filePaths: readonly string[],
): ExplanationDto[] {
	const fileOrder = new Map(filePaths.map((path, index) => [path, index]));
	const rank = (explanation: ExplanationDto) =>
		fileOrder.get(explanation.path) ?? Number.POSITIVE_INFINITY;
	return [...explanations].sort(
		(left, right) =>
			rank(left) - rank(right) || left.startLine - right.startLine,
	);
}
