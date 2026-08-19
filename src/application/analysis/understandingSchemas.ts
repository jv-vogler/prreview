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
 * - the overview is a `headline` plus a **list of lines**, never one string, so
 *   there is no field a paragraph can live in. This replaced a single
 *   `summary: string().max(600)`, which produced exactly what a 600-character
 *   text box asks for: a dense block of three long sentences that had to be
 *   decoded rather than read. The lesson was that the character budget was
 *   never the lever — a shorter wall is still a wall — and that the cap worth
 *   having is per *line*, because that is what forces a short sentence;
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

/** one sentence: what the change now does that it did not before */
export const OVERVIEW_HEADLINE_MAX = 120;
/** one point per line, and short enough that it has to be one sentence */
export const OVERVIEW_POINT_MAX = 160;
export const OVERVIEW_POINTS_MAX = 5;
/** two sentences, not the four that 400 characters invited */
const GOAL_MATCH_RATIONALE_MAX = 240;

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
		/** one sentence: what the change now does that it did not before */
		headline: z.string().max(OVERVIEW_HEADLINE_MAX),
		/**
		 * The rest of the overview, one point per line. An array rather than a
		 * string because the shape of the field is what the answer takes: given a
		 * text box, a model writes a text box.
		 */
		summary: z
			.array(z.string().max(OVERVIEW_POINT_MAX))
			.min(1)
			.max(OVERVIEW_POINTS_MAX),
		topics: z.array(topicOutSchema).max(granularity.maxTopics),
		suggestedEntryPoint: z.string(),
		goalMatch: goalMatchOutSchema,
	});
}

export type UnderstandingOut = z.infer<
	ReturnType<typeof buildUnderstandingOutSchema>
>;

/** a representative instance for the shape-level gates (CON-014, CON-005) */
export const representativeUnderstandingOutSchema = buildUnderstandingOutSchema(
	{
		targetTopicCount: 6,
		maxTopics: 10,
	},
);
