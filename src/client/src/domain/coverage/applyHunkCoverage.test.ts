import { describe, expect, it } from "vitest";
import { applyHunkCoverage } from "./applyHunkCoverage";

describe("applyHunkCoverage", () => {
	it("upgrades unseen to viewed and viewed to reviewed", () => {
		expect(applyHunkCoverage("unseen", "viewed")).toBe("viewed");
		expect(applyHunkCoverage("viewed", "reviewed")).toBe("reviewed");
		expect(applyHunkCoverage("unseen", "reviewed")).toBe("reviewed");
	});

	it("never downgrades between the two seen states", () => {
		expect(applyHunkCoverage("reviewed", "viewed")).toBe("reviewed");
	});

	/**
	 * The one direction that must work: unticking GitHub's "Viewed" box is a
	 * statement, not a stray event. Coverage was monotonic in every direction
	 * back when a scroll observer wrote it and an out-of-order event could have
	 * undone real work; the box is the only writer now.
	 */
	it("clears back to unseen when asked explicitly", () => {
		expect(applyHunkCoverage("reviewed", "unseen")).toBe("unseen");
		expect(applyHunkCoverage("viewed", "unseen")).toBe("unseen");
	});

	it("is idempotent on equal states", () => {
		expect(applyHunkCoverage("viewed", "viewed")).toBe("viewed");
	});
});
