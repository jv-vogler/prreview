import { z } from "zod";
import type { TopicGranularity } from "../../domain/analysis/topicGranularity";
import { TOPIC_SUMMARY_MAX, TOPIC_TITLE_MAX } from "./topicSchemas";

/**
 * The comprehension pass's output contract: one agent run that feeds **both**
 * the Overview tab and the Understanding tab.
 *
 * One pass, two screens, because they need the same understanding of the change
 * and paying twice for it would be waste. What differs is presentation: Overview
 * answers "what is this for, and does the code do it", Understanding answers
 * "what changed, told as topics, each carrying its code".
 *
 * Structural rules, all enforced here rather than requested in a prompt:
 *
 * - topics carry `hunkIds` and **no line numbers**, so narration has nowhere to
 *   drift into line-by-line commentary;
 * - `title` ≤ 60 and `summary` ≤ 280, so conciseness is a wall;
 * - `topics` is capped per round by `topicGranularity`, whose other half is what
 *   the prompt asks for — derived together so they cannot disagree;
 * - `goalMatch` carries a verdict and a rationale but **not** a basis. The
 *   server stamps the basis from whether a ticket was actually discovered, so
 *   an inferred verdict can never be dressed up in ticket-grounded language.
 */

const topicRefOutSchema = z.object({
	path: z.string(),
	/** empty means the whole file — honest when hunk ids cannot be resolved */
	hunkIds: z.array(z.string()),
});

const topicOutSchema = z.object({
	title: z.string().max(TOPIC_TITLE_MAX),
	summary: z.string().max(TOPIC_SUMMARY_MAX),
	kind: z.enum([
		"core",
		"refactor",
		"tests",
		"config",
		"docs",
		"generated",
		"chore",
	]),
	refs: z.array(topicRefOutSchema),
});

const GOAL_MATCH_RATIONALE_MAX = 400;

/**
 * Whether the code does what the change set out to do.
 *
 * `unclear` exists so the honest answer is always available: a change whose
 * purpose cannot be determined from the code should say so rather than pick a
 * verdict to satisfy the schema.
 */
const goalMatchOutSchema = z.object({
	verdict: z.enum(["matches", "partly", "diverges", "unclear"]),
	rationale: z.string().max(GOAL_MATCH_RATIONALE_MAX),
});

export function buildUnderstandingOutSchema(granularity: TopicGranularity) {
	return z.object({
		/** what this change is for, in one short paragraph */
		summary: z.string().max(600),
		topics: z.array(topicOutSchema).max(granularity.maxTopics),
		suggestedEntryPoint: z.string(),
		goalMatch: goalMatchOutSchema,
	});
}

export type UnderstandingOut = z.infer<
	ReturnType<typeof buildUnderstandingOutSchema>
>;

/** a representative instance for the shape-level gates (CON-014, CON-005) */
export const representativeUnderstandingOutSchema = buildUnderstandingOutSchema({
	targetTopicCount: 6,
	maxTopics: 10,
});
