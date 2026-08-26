export const TOPIC_COLOR_COUNT = 6;

export function topicColorsFor(
	explanations: readonly { topic?: string }[],
): ReadonlyMap<string, number> {
	const colors = new Map<string, number>();
	for (const explanation of explanations) {
		if (explanation.topic !== undefined && !colors.has(explanation.topic)) {
			colors.set(explanation.topic, colors.size % TOPIC_COLOR_COUNT);
		}
	}
	return colors;
}
