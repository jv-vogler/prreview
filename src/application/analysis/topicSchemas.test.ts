import { describe, expect, it } from "vitest";
import { topicGranularity } from "../../domain/analysis/topicGranularity";
import { toJsonSchema } from "./toJsonSchema";
import {
	buildTopicsOutSchema,
	TOPIC_SUMMARY_MAX,
	TOPIC_TITLE_MAX,
} from "./topicSchemas";

const GRANULARITY = { targetTopicCount: 3, maxTopics: 5 };

function makeTopic(overrides: Record<string, unknown> = {}) {
	return {
		title: "Reshape the session store's write path",
		summary: "Writes now go through one atomic helper instead of three.",
		kind: "core",
		refs: [{ path: "src/store.ts", hunkIds: ["h1"] }],
		...overrides,
	};
}

function makeOutput(topicCount: number) {
	return {
		summary: "what this change is for",
		topics: Array.from({ length: topicCount }, () => makeTopic()),
		suggestedEntryPoint: "src/store.ts",
	};
}

describe("buildTopicsOutSchema", () => {
	const schema = buildTopicsOutSchema(GRANULARITY);

	it("accepts a well-formed pass", () => {
		expect(schema.safeParse(makeOutput(3)).success).toBe(true);
	});

	it("accepts silence: no floor on how many topics a change has", () => {
		expect(schema.safeParse(makeOutput(0)).success).toBe(true);
	});

	it("enforces the round's cap, so granularity is a wall and not advice", () => {
		expect(schema.safeParse(makeOutput(GRANULARITY.maxTopics)).success).toBe(
			true,
		);
		expect(
			schema.safeParse(makeOutput(GRANULARITY.maxTopics + 1)).success,
		).toBe(false);
	});

	it("takes its cap from whatever granularity it is given", () => {
		const wide = buildTopicsOutSchema({ targetTopicCount: 8, maxTopics: 12 });
		expect(wide.safeParse(makeOutput(12)).success).toBe(true);
		expect(wide.safeParse(makeOutput(13)).success).toBe(false);
	});

	it("caps the title, so conciseness is structural", () => {
		expect(
			schema.safeParse({
				...makeOutput(0),
				topics: [makeTopic({ title: "x".repeat(TOPIC_TITLE_MAX) })],
			}).success,
		).toBe(true);
		expect(
			schema.safeParse({
				...makeOutput(0),
				topics: [makeTopic({ title: "x".repeat(TOPIC_TITLE_MAX + 1) })],
			}).success,
		).toBe(false);
	});

	it("caps the summary the same way", () => {
		expect(
			schema.safeParse({
				...makeOutput(0),
				topics: [makeTopic({ summary: "x".repeat(TOPIC_SUMMARY_MAX + 1) })],
			}).success,
		).toBe(false);
	});

	/**
	 * The structural defence against line-by-line narration: there is nowhere to
	 * put a line number, so it cannot be produced.
	 */
	it("gives line numbers nowhere to live", () => {
		const json = JSON.parse(toJsonSchema(schema));
		const refProperties =
			json.properties.topics.items.properties.refs.items.properties;
		expect(Object.keys(refProperties).sort()).toEqual(["hunkIds", "path"]);

		const topicProperties = json.properties.topics.items.properties;
		expect(Object.keys(topicProperties).sort()).toEqual([
			"kind",
			"refs",
			"summary",
			"title",
		]);
		// and no additional properties may sneak one in
		expect(json.properties.topics.items.additionalProperties).toBe(false);
	});

	it("rejects an unknown topic kind rather than accepting a freeform label", () => {
		expect(
			schema.safeParse({
				...makeOutput(0),
				topics: [makeTopic({ kind: "miscellaneous" })],
			}).success,
		).toBe(false);
	});

	it("carries the derived cap into the JSON Schema the CLI enforces", () => {
		const granularity = topicGranularity([]);
		const json = JSON.parse(toJsonSchema(buildTopicsOutSchema(granularity)));
		expect(json.properties.topics.maxItems).toBe(granularity.maxTopics);
	});
});
