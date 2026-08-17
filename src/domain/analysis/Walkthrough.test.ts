import { describe, expect, it } from "vitest";
import { type WalkthroughStep, walkthroughHunkIds } from "./Walkthrough";

function makeStep(focus: WalkthroughStep["focus"]): WalkthroughStep {
	return {
		index: 0,
		title: "start with the port",
		narration: "the port defines the contract everything else follows",
		focus,
	};
}

describe("walkthroughHunkIds", () => {
	it("collects every hunkId a step focuses on", () => {
		const step = makeStep([
			{ path: "src/a.ts", hunkIds: ["h1", "h2"] },
			{ path: "src/b.ts", hunkIds: ["h3"] },
		]);
		expect(walkthroughHunkIds(step)).toEqual(["h1", "h2", "h3"]);
	});

	it("deduplicates across focus entries, keeping first-seen order", () => {
		const step = makeStep([
			{ path: "src/a.ts", hunkIds: ["h2", "h1"] },
			{ path: "src/b.ts", hunkIds: ["h1", "h3", "h2"] },
		]);
		expect(walkthroughHunkIds(step)).toEqual(["h2", "h1", "h3"]);
	});

	it("returns an empty list for a step with no focus", () => {
		expect(walkthroughHunkIds(makeStep([]))).toEqual([]);
	});
});
