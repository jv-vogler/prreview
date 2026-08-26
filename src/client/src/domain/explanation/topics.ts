import type { ExplanationDto } from "@dto/ReviewDto";

export interface Topic {
	label: string;
	explanations: ExplanationDto[];
}

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

export function topicPaths(topic: Topic): string[] {
	return [...new Set(topic.explanations.map((entry) => entry.path))];
}

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
