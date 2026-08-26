import { describe, expect, it } from "vitest";
import { findingId, findingIdAt, findingIndexFor } from "./findingId";

describe("a pass that names no ids of its own", () => {
	const stored = {};

	it("names each finding by its position", () => {
		expect(findingIdAt(stored, 0)).toBe("finding-0");
		expect(findingIdAt(stored, 7)).toBe("finding-7");
	});

	it("round-trips through findingIndexFor", () => {
		expect(findingIndexFor(stored, findingId(0))).toBe(0);
		expect(findingIndexFor(stored, findingId(7))).toBe(7);
	});

	it("rejects an id with no matching prefix", () => {
		expect(findingIndexFor(stored, "comment-3")).toBeNull();
	});

	it("rejects an id whose suffix is not a plain non-negative integer", () => {
		expect(findingIndexFor(stored, "finding-")).toBeNull();
		expect(findingIndexFor(stored, "finding-3.5")).toBeNull();
		expect(findingIndexFor(stored, "finding--1")).toBeNull();
		expect(findingIndexFor(stored, "finding-x")).toBeNull();
	});
});

describe("a pass carrying its own ids", () => {
	const stored = { findingIds: ["finding-4", "finding-0", "finding-9"] };

	it("names each finding by the id the pass stored", () => {
		expect(findingIdAt(stored, 0)).toBe("finding-4");
		expect(findingIdAt(stored, 1)).toBe("finding-0");
	});

	it("resolves a stored id to wherever that finding now sits", () => {
		expect(findingIndexFor(stored, "finding-9")).toBe(2);
		expect(findingIndexFor(stored, "finding-0")).toBe(1);
	});

	it("never reads a stored id as a position", () => {
		expect(findingIndexFor(stored, "finding-2")).toBeNull();
	});

	it("still names a position the pass ran out of ids for", () => {
		expect(findingIdAt(stored, 3)).toBe("finding-3");
		expect(findingIndexFor(stored, "finding-3")).toBe(3);
	});
});
