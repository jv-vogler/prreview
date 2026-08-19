import { z } from "zod";
import type { TopicGranularity } from "../../domain/analysis/topicGranularity";

/**
 * The agent-facing contract for the comprehension pass's topics.
 *
 * Three properties of this schema are load-bearing, and all three are
 * *structural* rather than politely requested in a prompt — a prompt sentence
 * is advice the model may weigh against everything else it was told, while a
 * schema is a wall the CLI itself enforces and retries against (CON-006):
 *
 * 1. **Conciseness.** `title` ≤ 60 and `summary` ≤ 280 characters. "Be concise"
 *    in a prompt produces a paragraph; `.max(280)` produces a sentence.
 * 2. **No line numbers, anywhere.** A topic addresses `hunkIds` and nothing
 *    finer. Narration that *cannot* name a line cannot drift into line-by-line
 *    commentary, which is the failure mode explanations had.
 * 3. **A per-round cap.** `maxTopics` comes from `topicGranularity`, the same
 *    derivation that produces the `targetTopicCount` the prompt asks for, so
 *    the two can never disagree — the bug where a prompt asks for 20 against a
 *    schema that allows 6, and every run fails validation.
 */

const topicRefOutSchema = z.object({
	path: z.string(),
	/**
	 * Empty means the whole file. Kept permissive on purpose: an agent that
	 * genuinely cannot resolve hunk ids should say "this file" rather than
	 * invent ids, and the sizing rules already treat that honestly.
	 */
	hunkIds: z.array(z.string()),
});

/** the caps, in one place, so prompt copy can quote the real numbers */
export const TOPIC_TITLE_MAX = 60;
export const TOPIC_SUMMARY_MAX = 280;

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

/**
 * Stage A's output: the change retold as topics, plus the orientation the
 * Overview tab needs.
 *
 * `topics` has **no minimum**: a change with one idea is one topic, and forcing
 * a floor would manufacture distinctions that are not there.
 */
export function buildTopicsOutSchema(granularity: TopicGranularity) {
	return z.object({
		summary: z.string().max(600),
		topics: z.array(topicOutSchema).max(granularity.maxTopics),
		suggestedEntryPoint: z.string(),
	});
}

export type TopicsOut = z.infer<ReturnType<typeof buildTopicsOutSchema>>;

/**
 * A representative instance for the checks that must hold for every task schema
 * regardless of round — the Ajv draft-07 gate (CON-014) and the argv budget
 * (CON-005). Both are properties of the schema's *shape*, which does not vary
 * with the cap, so pinning one instance is enough and keeps the registry a list
 * of values rather than of factories.
 */
export const representativeTopicsOutSchema = buildTopicsOutSchema({
	targetTopicCount: 6,
	maxTopics: 10,
});
