import { describe, expect, it } from "vitest";
import { findingIndexForCommentId, reviewCommentId } from "./reviewCommentId";

describe("reviewCommentId", () => {
	it("round-trips through findingIndexForCommentId", () => {
		expect(findingIndexForCommentId(reviewCommentId(0))).toBe(0);
		expect(findingIndexForCommentId(reviewCommentId(7))).toBe(7);
	});

	it("rejects an id with no matching prefix", () => {
		expect(findingIndexForCommentId("comment-3")).toBeNull();
	});

	it("rejects an id whose suffix is not a plain non-negative integer", () => {
		expect(findingIndexForCommentId("finding-")).toBeNull();
		expect(findingIndexForCommentId("finding-3.5")).toBeNull();
		expect(findingIndexForCommentId("finding--1")).toBeNull();
		expect(findingIndexForCommentId("finding-x")).toBeNull();
	});
});
