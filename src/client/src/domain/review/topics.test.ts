import type { ExplanationDto } from "@dto/ReviewDto";
import { describe, expect, it } from "vitest";
import { topicsFor } from "./topics";

function explanation(id: string, topic: string | undefined): ExplanationDto {
	return {
		id,
		path: "src/a.ts",
		startLine: 1,
		endLine: 1,
		says: [`Behind ${id}.`],
		...(topic === undefined ? {} : { topic }),
		placement: { kind: "exact", fileId: "file-1", side: "new", line: 1 },
	};
}

describe("topicsFor", () => {
	it("groups explanations sharing a label, in first-mention order", () => {
		const topics = topicsFor([
			explanation("explanation-0", "cache TTL"),
			explanation("explanation-1", "error paths"),
			explanation("explanation-2", "cache TTL"),
		]);
		expect(topics.map((topic) => topic.label)).toEqual([
			"cache TTL",
			"error paths",
		]);
		expect(topics[0].explanations.map((entry) => entry.id)).toEqual([
			"explanation-0",
			"explanation-2",
		]);
	});

	it("projects unlabeled explanations into no topic", () => {
		expect(topicsFor([explanation("explanation-0", undefined)])).toEqual([]);
	});
});
