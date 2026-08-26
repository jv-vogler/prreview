import type { ExplanationDto } from "@dto/ReviewDto";

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
