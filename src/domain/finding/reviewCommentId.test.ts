import { describe, expect, it } from "vitest";
import {
	commentIdAt,
	findingIndexForComment,
	reviewCommentId,
} from "./reviewCommentId";

describe("a pass that names no ids of its own", () => {
	const stored = {};

	it("names each finding by its position", () => {
		expect(commentIdAt(stored, 0)).toBe("finding-0");
		expect(commentIdAt(stored, 7)).toBe("finding-7");
	});

	it("round-trips through findingIndexForComment", () => {
		expect(findingIndexForComment(stored, reviewCommentId(0))).toBe(0);
		expect(findingIndexForComment(stored, reviewCommentId(7))).toBe(7);
	});

	it("rejects an id with no matching prefix", () => {
		expect(findingIndexForComment(stored, "comment-3")).toBeNull();
	});

	it("rejects an id whose suffix is not a plain non-negative integer", () => {
		expect(findingIndexForComment(stored, "finding-")).toBeNull();
		expect(findingIndexForComment(stored, "finding-3.5")).toBeNull();
		expect(findingIndexForComment(stored, "finding--1")).toBeNull();
		expect(findingIndexForComment(stored, "finding-x")).toBeNull();
	});
});

describe("a pass carrying its own ids", () => {
	const stored = { findingIds: ["finding-4", "finding-0", "finding-9"] };

	it("names each finding by the id the pass stored", () => {
		expect(commentIdAt(stored, 0)).toBe("finding-4");
		expect(commentIdAt(stored, 1)).toBe("finding-0");
	});

	it("resolves a stored id to wherever that finding now sits", () => {
		expect(findingIndexForComment(stored, "finding-9")).toBe(2);
		expect(findingIndexForComment(stored, "finding-0")).toBe(1);
	});

	it("never reads a stored id as a position", () => {
		expect(findingIndexForComment(stored, "finding-2")).toBeNull();
	});

	it("still names a position the pass ran out of ids for", () => {
		expect(commentIdAt(stored, 3)).toBe("finding-3");
		expect(findingIndexForComment(stored, "finding-3")).toBe(3);
	});
});
