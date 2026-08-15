import { describe, expect, it } from "vitest";
import type { HunkCoverage } from "./HunkCoverage";
import { upgradeHunkCoverage } from "./upgradeHunkCoverage";

describe("upgradeHunkCoverage", () => {
	const table: [HunkCoverage, HunkCoverage, HunkCoverage][] = [
		["unseen", "unseen", "unseen"],
		["unseen", "viewed", "viewed"],
		["unseen", "reviewed", "reviewed"],
		["viewed", "unseen", "viewed"],
		["viewed", "viewed", "viewed"],
		["viewed", "reviewed", "reviewed"],
		["reviewed", "unseen", "reviewed"],
		["reviewed", "viewed", "reviewed"],
		["reviewed", "reviewed", "reviewed"],
	];

	it.each(table)("%s + %s → %s", (current, requested, expected) => {
		expect(upgradeHunkCoverage(current, requested)).toBe(expected);
	});

	it("never downgrades reviewed, whatever is requested", () => {
		for (const requested of ["unseen", "viewed", "reviewed"] as const) {
			expect(upgradeHunkCoverage("reviewed", requested)).toBe("reviewed");
		}
	});
});
