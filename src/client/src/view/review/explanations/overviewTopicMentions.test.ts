import { describe, expect, it } from "vitest";
import { linkTopicMentions, topicFromHref } from "./overviewTopicMentions";

describe("linkTopicMentions", () => {
	it("links each verbatim mention to its topic href", () => {
		const linked = linkTopicMentions("The renderer cache moves twice.", [
			"renderer cache",
		]);
		expect(linked).toBe(
			"The [renderer cache](#topic:renderer%20cache) moves twice.",
		);
	});

	it("never links inside backticks", () => {
		const linked = linkTopicMentions(
			"The renderer cache is not `renderer cache` the token.",
			["renderer cache"],
		);
		expect(linked).toContain("[renderer cache](#topic:renderer%20cache) is");
		expect(linked).toContain("`renderer cache` the token");
	});

	it("prefers the longer label when one contains another", () => {
		const linked = linkTopicMentions("The renderer cache counter.", [
			"renderer",
			"renderer cache",
		]);
		expect(linked).toContain("[renderer cache](#topic:renderer%20cache)");
	});

	it("skips a label markdown link syntax would break on", () => {
		expect(linkTopicMentions("stays [as] is", ["[as]"])).toBe("stays [as] is");
	});
});

describe("topicFromHref", () => {
	it("round-trips the label and rejects other hrefs", () => {
		expect(topicFromHref("#topic:renderer%20cache")).toBe("renderer cache");
		expect(topicFromHref("https://example.com")).toBeNull();
	});
});
