import { describe, expect, it } from "vitest";
import { walkthroughHunkIds } from "../../domain/analysis/Walkthrough";
import type { ComprehensionOut } from "./schemas";
import { walkthroughFromComprehension } from "./walkthroughFromComprehension";

function comprehension(
	steps: ComprehensionOut["walkthrough"]["steps"],
): ComprehensionOut {
	return {
		intentMap: { summary: "s", clusters: [], suggestedEntryPoint: "a.ts" },
		walkthrough: { steps },
		explanations: [],
		risk: { hunkRisks: [] },
	};
}

describe("walkthroughFromComprehension", () => {
	it("numbers the steps by the order the agent emitted them", () => {
		const walkthrough = walkthroughFromComprehension(
			comprehension([
				{
					title: "first",
					narration: "start here",
					focus: [{ path: "a.ts", hunkIds: ["F1h1"] }],
				},
				{
					title: "second",
					narration: "then this",
					focus: [{ path: "b.ts", hunkIds: ["F2h1", "F2h2"] }],
				},
			]),
		);

		expect(walkthrough.steps.map((step) => step.index)).toEqual([0, 1]);
		expect(walkthrough.steps[1].title).toBe("second");
		expect(walkthroughHunkIds(walkthrough.steps[1])).toEqual(["F2h1", "F2h2"]);
	});

	it("keeps an empty walkthrough empty", () => {
		expect(walkthroughFromComprehension(comprehension([])).steps).toEqual([]);
	});

	it("copies the focus lists instead of sharing them with the stored output", () => {
		const stored = comprehension([
			{
				title: "only",
				narration: "n",
				focus: [{ path: "a.ts", hunkIds: ["F1h1"] }],
			},
		]);
		const walkthrough = walkthroughFromComprehension(stored);
		walkthrough.steps[0].focus[0].hunkIds.push("F9h9");
		expect(stored.walkthrough.steps[0].focus[0].hunkIds).toEqual(["F1h1"]);
	});
});
