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

	it("keeps a folder's files together, folders ordered by their biggest file", () => {
		const sorted = sortFilesByAttention([
			file("src/api/routes.ts", 30, 0),
			file("src/ui/Button.tsx", 50, 0),
			file("src/api/client.ts", 4, 0),
			file("src/ui/Card.tsx", 2, 0),
		]);
		expect(sorted.map((f) => f.path)).toEqual([
			"src/ui/Button.tsx",
			"src/ui/Card.tsx",
			"src/api/routes.ts",
			"src/api/client.ts",
		]);
	});

	it("does not let a folder full of small files outrank one big change", () => {
		const sorted = sortFilesByAttention([
			file("docs/a.md", 9, 0),
			file("docs/b.md", 9, 0),
			file("docs/c.md", 9, 0),
			file("src/core.ts", 20, 0),
		]);
		expect(sorted[0]?.path).toBe("src/core.ts");
	});

	it("groups generated files too, still after everything else", () => {
		const sorted = sortFilesByAttention([
			file("vendor/a.js", 900, 0, true),
			file("src/app.ts", 1, 0),
			file("vendor/b.js", 800, 0, true),
		]);
		expect(sorted.map((f) => f.path)).toEqual([
			"src/app.ts",
			"vendor/a.js",
			"vendor/b.js",
		]);
	});

	it("does not mutate the input", () => {
		const input = [file("b.ts", 1, 0), file("a.ts", 9, 0)];
		sortFilesByAttention(input);
		expect(input.map((f) => f.path)).toEqual(["b.ts", "a.ts"]);
	});
});
