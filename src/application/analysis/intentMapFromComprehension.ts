import type { IntentMap } from "../../domain/analysis/IntentMap";
import type { ComprehensionOut } from "./schemas";

/**
 * The stored stage output as the intent map the rest of the program uses. The
 * one real conversion is hunk precision: the agent may name a cluster member
 * without hunkIds, meaning "this whole file", and the domain spells that as an
 * empty list so every consumer handles one shape.
 */
export function intentMapFromComprehension(
	comprehension: ComprehensionOut,
): IntentMap {
	const { intentMap } = comprehension;
	return {
		summary: intentMap.summary,
		suggestedEntryPoint: intentMap.suggestedEntryPoint,
		clusters: intentMap.clusters.map((cluster) => ({
			name: cluster.name,
			kind: cluster.kind,
			description: cluster.description,
			members: cluster.members.map((member) => ({
				path: member.path,
				hunkIds: [...(member.hunkIds ?? [])],
			})),
		})),
	};
}
