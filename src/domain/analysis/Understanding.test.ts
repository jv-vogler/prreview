import { describe, expect, it } from "vitest";
import type { FileDiff } from "../changeset/FileDiff";
import type { UnderstandingDraft } from "./Understanding";
import { buildUnderstanding } from "./Understanding";

const FILES: FileDiff[] = [
	{
		id: "f1",
		path: "src/core.ts",
		status: "modified",
		additions: 4,
		deletions: 0,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: null,
		hunks: [
			{
				id: "h1",
				header: "",
				oldStart: 1,
				oldLines: 1,
				newStart: 1,
				newLines: 5,
				lines: [{ type: "add", content: "added", newLine: 1 }],
			},
			{
				id: "h2",
				header: "",
				oldStart: 9,
				oldLines: 1,
				newStart: 9,
				newLines: 5,
				lines: [{ type: "add", content: "added", newLine: 9 }],
			},
		],
	},
];

function makeDraft(overrides: Partial<UnderstandingDraft> = {}) {
	return {
		headline: "Webhook deliveries now retry instead of dropping.",
		summary: ["A failed delivery is retried with backoff."],
		topics: [
			{
				title: "Retry webhook delivery",
				summary: "Failed deliveries now retry with backoff.",
				kind: "core" as const,
				refs: [{ path: "src/core.ts", hunkIds: ["h1"] }],
			},
		],
		suggestedEntryPoint: "src/core.ts",
		goalMatch: { verdict: "matches" as const, rationale: "it does" },
		...overrides,
	};
}

describe("buildUnderstanding", () => {
	it("assigns positional topic ids", () => {
		const built = buildUnderstanding({
			draft: makeDraft({
				topics: [
					{ ...makeDraft().topics[0], title: "first" },
					{ ...makeDraft().topics[0], title: "second" },
				],
			}),
			files: FILES,
			ticket: null,
		});
		expect(built.topics.map((topic) => topic.id)).toEqual(["t1", "t2"]);
	});

	it("derives what no topic accounts for", () => {
		const built = buildUnderstanding({
			draft: makeDraft(),
			files: FILES,
			ticket: null,
		});
		expect(built.uncoveredHunks).toEqual([
			{ path: "src/core.ts", hunkId: "h2" },
		]);
	});

	/**
	 * The stamp is the whole point of `basis`: the agent never gets to claim a
	 * verdict is ticket-grounded, because it does not know what prreview found.
	 */
	it("stamps the basis as inferred when no ticket was discovered", () => {
		const built = buildUnderstanding({
			draft: makeDraft(),
			files: FILES,
			ticket: null,
		});
		expect(built.goalMatch.basis).toBe("inferred");
		expect(built.goalMatch.ticket).toBeNull();
	});

	it("stamps the basis as ticket only when one was discovered", () => {
		const built = buildUnderstanding({
			draft: makeDraft(),
			files: FILES,
			ticket: { key: "ENG-7", source: "branch" },
		});
		expect(built.goalMatch.basis).toBe("ticket");
		expect(built.goalMatch.ticket).toEqual({ key: "ENG-7", source: "branch" });
	});

	it("carries the verdict and rationale through unchanged", () => {
		const built = buildUnderstanding({
			draft: makeDraft({
				goalMatch: { verdict: "diverges", rationale: "it does something else" },
			}),
			files: FILES,
			ticket: null,
		});
		expect(built.goalMatch.verdict).toBe("diverges");
		expect(built.goalMatch.rationale).toBe("it does something else");
	});

	it("handles a pass that produced no topics at all", () => {
		const built = buildUnderstanding({
			draft: makeDraft({ topics: [] }),
			files: FILES,
			ticket: null,
		});
		expect(built.topics).toEqual([]);
		expect(built.uncoveredHunks).toHaveLength(2);
	});
});
