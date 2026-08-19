import { describe, expect, it } from "vitest";
import { handleFor, partitionOps, resolveHandle } from "./annotationOps";

const ordered = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("handles", () => {
	/**
	 * The client derives handles by position over the same list the server
	 * resolves them against. If either side changed which annotations are in
	 * that list — findings only, say, rather than findings and related findings
	 * — `F3` would mean different comments on the two sides, and a dismissal
	 * would land on the wrong one.
	 */
	it("is one-based position, on both sides of the wire", () => {
		expect(handleFor(0)).toBe("F1");
		expect(handleFor(2)).toBe("F3");
		expect(resolveHandle("F1", ordered)).toBe("a");
		expect(resolveHandle("F3", ordered)).toBe("c");
	});

	it("accepts a lowercase or padded handle, because people type", () => {
		expect(resolveHandle("f2", ordered)).toBe("b");
		expect(resolveHandle("  F2  ", ordered)).toBe("b");
	});

	it("refuses anything that is not a handle rather than guessing", () => {
		expect(resolveHandle("F0", ordered)).toBeNull();
		expect(resolveHandle("F9", ordered)).toBeNull();
		expect(resolveHandle("the first one", ordered)).toBeNull();
		expect(resolveHandle("", ordered)).toBeNull();
	});
});

describe("partitionOps", () => {
	it("resolves what it can and reports what it cannot", () => {
		const { resolved, rejected } = partitionOps(
			[
				{ op: "drop", handle: "F1" },
				{ op: "drop", handle: "F9" },
			],
			ordered,
		);
		expect(resolved).toHaveLength(1);
		expect(resolved[0]?.id).toBe("a");
		expect(rejected).toHaveLength(1);
		expect(rejected[0]?.reason).toContain("F9");
	});

	it("never silently drops an op it could not resolve", () => {
		const { resolved, rejected } = partitionOps(
			[{ op: "drop", handle: "nonsense" }],
			ordered,
		);
		expect(resolved).toEqual([]);
		expect(rejected).toHaveLength(1);
	});
});
