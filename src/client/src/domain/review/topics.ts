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

/**
 * The topic's own account, built from the sentences it already carries: the
 * lead sentence of each explanation under it, in order, up to three. The
 * agent is not asked for a second summary of a thing it has already
 * described, and a folded topic still says what it is about.
 *
 * Returned as the sentences rather than one string so a caller can render
 * the account and then leave those sentences out of the per-file entries
 * below it, instead of printing each one twice.
 */
export function topicSummaryLeads(topic: Topic): string[] {
	const leads: string[] = [];
	for (const explanation of topic.explanations) {
		const lead = explanation.says[0];
		if (lead !== undefined && !leads.includes(lead)) {
			leads.push(lead);
		}
		if (leads.length === SUMMARY_SENTENCES_MAX) {
			break;
		}
	}
	return leads;
}

export function topicSummary(topic: Topic): string {
	return topicSummaryLeads(topic).join(" ");
}

/** the files a topic reaches across, in the order its explanations do */
export function topicPaths(topic: Topic): string[] {
	return [...new Set(topic.explanations.map((entry) => entry.path))];
}

/** three sentences is a paragraph; a fourth is a wall in a sidebar column */
const SUMMARY_SENTENCES_MAX = 3;

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
