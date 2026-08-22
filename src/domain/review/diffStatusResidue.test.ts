import { describe, expect, it } from "vitest";
import { diffStatusResidue } from "./diffStatusResidue";

describe("diffStatusResidue", () => {
	it("is empty when nothing changed", () => {
		const status = " M src/index.ts\n";
		expect(diffStatusResidue(status, status)).toEqual([]);
	});

	it("reports a file the run left behind on an otherwise clean tree", () => {
		expect(diffStatusResidue("", "?? scratch-test.ts\n")).toEqual([
			"scratch-test.ts",
		]);
	});

	it("does not blame the agent for dirt that predates the run", () => {
		const before = " M src/index.ts\n?? already-untracked.ts\n";
		const after =
			" M src/index.ts\n?? already-untracked.ts\n?? new-residue.ts\n";
		expect(diffStatusResidue(before, after)).toEqual(["new-residue.ts"]);
	});

	it("ignores blank lines", () => {
		expect(diffStatusResidue("\n", "\n")).toEqual([]);
	});
});
