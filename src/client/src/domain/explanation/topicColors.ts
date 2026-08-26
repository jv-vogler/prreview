/**
 * Which of the palette's slots a topic label wears, everywhere it appears:
 * every "renderer cache" balloon carries the same color, so repeated topics
 * match at a glance without reading a single label. Assignment is by
 * first-mention order in the pass, so it is stable across reloads of the
 * same pass and never depends on where in the diff the reader is looking.
 * The palette itself lives in CSS; labels beyond its size wrap around.
 */
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
