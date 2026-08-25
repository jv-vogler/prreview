import type { ExplanationDto } from "@dto/ReviewDto";

/**
 * The topics view is a projection of the explanations, never separate
 * data: explanations sharing a `topic` label form one topic, in the order
 * the pass first mentions them. Unlabeled explanations stand alone on the
 * diff and project into no topic.
 */
export interface Topic {
	label: string;
	explanations: ExplanationDto[];
}

export function topicsFor(explanations: readonly ExplanationDto[]): Topic[] {
	const byLabel = new Map<string, Topic>();
	for (const explanation of explanations) {
		if (explanation.topic === undefined) {
			continue;
		}
		const existing = byLabel.get(explanation.topic);
		if (existing === undefined) {
			byLabel.set(explanation.topic, {
				label: explanation.topic,
				explanations: [explanation],
			});
		} else {
			existing.explanations.push(explanation);
		}
	}
	return [...byLabel.values()];
}
