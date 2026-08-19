import type { FileDiff } from "../changeset/FileDiff";
import type { TicketHint } from "./discoverTicket";
import type { Topic, TopicKind } from "./Topic";
import { uncoveredHunks } from "./Topic";

/**
 * Whether the code does what the change set out to do.
 *
 * `basis` is the field that keeps this honest. A verdict grounded in a
 * discovered ticket and a verdict inferred from the change's own internal
 * coherence are different claims, and stating the second in the language of the
 * first is the kind of overreach that costs a tool its credibility. So `basis`
 * is **stamped by the server** from whether ticket discovery actually
 * succeeded — never taken from the agent, which has every incentive to sound
 * authoritative and no way to know what prreview looked for.
 */
export interface GoalMatch {
	verdict: "matches" | "partly" | "diverges" | "unclear";
	rationale: string;
	basis: "ticket" | "inferred";
	/** null whenever `basis` is 'inferred' — the two cannot disagree */
	ticket: TicketHint | null;
}

/**
 * What one comprehension pass produced: everything the Overview and
 * Understanding tabs render, from a single run.
 */
export interface Understanding {
	/** one sentence: what the change now does that it did not before */
	headline: string;
	/**
	 * The rest of the overview, one point per line — never one paragraph.
	 *
	 * This was a single string, and what came back was a wall: three long
	 * sentences a reader had to decode instead of scan. The field's shape is
	 * what decides that, not its length, so the shape is a list.
	 */
	summary: string[];
	topics: Topic[];
	suggestedEntryPoint: string;
	goalMatch: GoalMatch;
	/**
	 * Hunks no topic accounts for. Derived here rather than by the agent, which
	 * cannot be trusted to report its own omissions, and surfaced rather than
	 * hidden so a lazy pass is visible.
	 */
	uncoveredHunks: { path: string; hunkId: string }[];
}

/** the agent's raw output, before ids, stamping, and derivation */
export interface UnderstandingDraft {
	headline: string;
	summary: string[];
	topics: {
		title: string;
		summary: string;
		kind: TopicKind;
		refs: { path: string; hunkIds: string[] }[];
	}[];
	suggestedEntryPoint: string;
	goalMatch: { verdict: GoalMatch["verdict"]; rationale: string };
}

export interface BuildUnderstandingInput {
	draft: UnderstandingDraft;
	files: readonly FileDiff[];
	ticket: TicketHint | null;
}

/**
 * Turns one pass's raw output into the persisted shape: stable topic ids, the
 * server-stamped basis, and the derived list of what went unaccounted for.
 *
 * Topic ids are positional (`t1`, `t2`, …) and therefore stable within a round
 * and meaningless across rounds, which is correct — a re-run produces different
 * topics, and pretending otherwise would let a stale deep link point at
 * something it never described.
 */
export function buildUnderstanding(
	input: BuildUnderstandingInput,
): Understanding {
	const topics: Topic[] = input.draft.topics.map((topic, index) => ({
		id: `t${index + 1}`,
		title: topic.title,
		summary: topic.summary,
		kind: topic.kind,
		refs: topic.refs,
	}));

	return {
		headline: input.draft.headline,
		summary: input.draft.summary,
		topics,
		suggestedEntryPoint: input.draft.suggestedEntryPoint,
		goalMatch: {
			verdict: input.draft.goalMatch.verdict,
			rationale: input.draft.goalMatch.rationale,
			// stamped from what prreview found, not from what the agent claims
			basis: input.ticket === null ? "inferred" : "ticket",
			ticket: input.ticket,
		},
		uncoveredHunks: uncoveredHunks(topics, input.files),
	};
}
