import { z } from "zod";

/**
 * One place in the change a topic points at. An empty `hunkIds` means the whole
 * file — the agent referenced it without hunk precision.
 */
const topicRefDtoSchema = z.object({
	path: z.string(),
	hunkIds: z.array(z.string()),
});

/**
 * A plain-language unit of intent, with the code that serves it.
 *
 * **Topic↔hunk is many-to-many**: the same hunk may appear under two topics
 * when two distinct things change in it, so topics do not partition the diff.
 * Consumers must key blocks composite (`${topicId}:${path}`), never by hunk
 * alone.
 *
 * There are deliberately **no line numbers** here. Narration that cannot
 * address a line cannot drift into line-by-line commentary, and the length caps
 * are on the schema for the same reason — conciseness is structural rather than
 * politely requested in a prompt.
 */
const topicDtoSchema = z.object({
	id: z.string(),
	title: z.string(),
	summary: z.string(),
	kind: z.enum([
		"core",
		"refactor",
		"tests",
		"config",
		"docs",
		"generated",
		"chore",
	]),
	refs: z.array(topicRefDtoSchema),
});

/** a hunk no topic accounts for — surfaced, never hidden */
const uncoveredHunkDtoSchema = z.object({
	path: z.string(),
	hunkId: z.string(),
});

/**
 * `GET /api/understanding`: the change retold as topics, plus what the pass
 * left unaccounted for. 404 with reason `not-produced` until the comprehension
 * pass has run.
 */
export const understandingDtoSchema = z.object({
	summary: z.string(),
	topics: z.array(topicDtoSchema),
	suggestedEntryPoint: z.string(),
	/**
	 * Hunks no topic references. Derived server-side rather than in the browser
	 * so one authority decides it, and reported so a lazy pass is visible rather
	 * than implied to be exhaustive.
	 */
	uncoveredHunks: z.array(uncoveredHunkDtoSchema),
});

export type TopicDto = z.infer<typeof topicDtoSchema>;
export type TopicRefDto = z.infer<typeof topicRefDtoSchema>;
export type UncoveredHunkDto = z.infer<typeof uncoveredHunkDtoSchema>;
export type UnderstandingDto = z.infer<typeof understandingDtoSchema>;
