import type { FileDiffDto } from "@dto/ChangesetDto";
import { describe, expect, it } from "vitest";
import { sortFilesByAttention } from "./sortFilesByAttention";

function file(
	path: string,
	additions: number,
	deletions: number,
	isGenerated = false,
): FileDiffDto {
	return {
		id: `f_${path}`,
		path,
		status: "modified",
		additions,
		deletions,
		isBinary: false,
		isGenerated,
		oldBlob: null,
		newBlob: null,
		hunks: [],
	};
}

describe("sortFilesByAttention", () => {
	it("orders by changed lines descending", () => {
		const sorted = sortFilesByAttention([
			file("small.ts", 1, 0),
			file("big.ts", 40, 10),
			file("medium.ts", 5, 5),
		]);
		expect(sorted.map((f) => f.path)).toEqual([
			"big.ts",
			"medium.ts",
			"small.ts",
		]);
	});

	it("puts generated files last regardless of size", () => {
		const sorted = sortFilesByAttention([
			file("package-lock.json", 900, 900, true),
			file("app.ts", 2, 1),
		]);
		expect(sorted.map((f) => f.path)).toEqual(["app.ts", "package-lock.json"]);
	});

	it("breaks ties on path for a deterministic order", () => {
		const sorted = sortFilesByAttention([
			file("b.ts", 3, 0),
			file("a.ts", 2, 1),
		]);
		expect(sorted.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
	});

	it("does not mutate the input", () => {
		const input = [file("b.ts", 1, 0), file("a.ts", 9, 0)];
		sortFilesByAttention(input);
		expect(input.map((f) => f.path)).toEqual(["b.ts", "a.ts"]);
	});
});
