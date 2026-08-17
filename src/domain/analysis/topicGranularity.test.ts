import { describe, expect, it } from "vitest";
import type { FileDiff } from "../changeset/FileDiff";
import { topicGranularity } from "./topicGranularity";

function makeFiles(count: number, changedPerFile: number): FileDiff[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `f${index}`,
		path: `src/file-${index}.ts`,
		status: "modified" as const,
		additions: changedPerFile,
		deletions: 0,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: null,
		hunks: [],
	}));
}

describe("topicGranularity", () => {
	it("asks for two topics on a tiny change, where headings only add noise", () => {
		expect(topicGranularity(makeFiles(1, 5))).toEqual({
			targetTopicCount: 2,
			maxTopics: 4,
		});
		expect(topicGranularity(makeFiles(2, 100))).toEqual({
			targetTopicCount: 2,
			maxTopics: 4,
		});
	});

	it("treats a wide but trivial change as tiny too", () => {
		// 10 files, 1 changed line each: a sweeping rename, not ten ideas
		expect(topicGranularity(makeFiles(10, 1)).targetTopicCount).toBe(2);
	});

	it("grows with the change, but far more slowly than file count", () => {
		expect(topicGranularity(makeFiles(9, 40)).targetTopicCount).toBe(3);
		expect(topicGranularity(makeFiles(25, 40)).targetTopicCount).toBe(5);
		expect(topicGranularity(makeFiles(50, 40)).targetTopicCount).toBe(7);
	});

	it("stops growing, because no change is fifty ideas", () => {
		expect(topicGranularity(makeFiles(100, 40)).targetTopicCount).toBe(8);
		expect(topicGranularity(makeFiles(500, 40)).targetTopicCount).toBe(8);
	});

	it("always leaves the schema headroom over what the prompt asks for", () => {
		for (const fileCount of [3, 9, 25, 50, 100, 500]) {
			const granularity = topicGranularity(makeFiles(fileCount, 40));
			expect(granularity.maxTopics).toBeGreaterThan(
				granularity.targetTopicCount,
			);
		}
	});

	it("handles an empty changeset without dividing by anything", () => {
		expect(topicGranularity([])).toEqual({ targetTopicCount: 2, maxTopics: 4 });
	});
});
