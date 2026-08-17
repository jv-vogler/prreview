import type { FileDiffDto } from "@dto/ChangesetDto";
import { describe, expect, it } from "vitest";
import { resolveEntryPoint } from "./resolveEntryPoint";

function file(
	id: string,
	path: string,
	hunkIds: readonly string[],
): FileDiffDto {
	return {
		id,
		path,
		status: "modified",
		additions: 1,
		deletions: 0,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: null,
		hunks: hunkIds.map((hunkId) => ({
			id: hunkId,
			header: "@@",
			oldStart: 1,
			oldLines: 1,
			newStart: 1,
			newLines: 1,
			lines: [],
		})),
	};
}

const FILES = [
	file("f1", "src/greeting.ts", ["F1h1", "F1h12"]),
	file("f2", "src/main.ts", ["F2h1"]),
];

describe("resolveEntryPoint", () => {
	it("resolves a bare path", () => {
		expect(resolveEntryPoint("src/main.ts", FILES)).toEqual({
			fileId: "f2",
			path: "src/main.ts",
			hunkId: null,
		});
	});

	it("resolves a hunk id mentioned in a sentence", () => {
		expect(
			resolveEntryPoint("Start with F1h1 to see the API change.", FILES),
		).toEqual({ fileId: "f1", path: "src/greeting.ts", hunkId: "F1h1" });
	});

	it("takes whatever the sentence mentions first", () => {
		expect(
			resolveEntryPoint("Read src/main.ts before F1h1 makes sense.", FILES),
		).toEqual({ fileId: "f2", path: "src/main.ts", hunkId: null });
	});

	it("prefers the hunk when a path and its hunk are named together", () => {
		expect(resolveEntryPoint("src/main.ts (F2h1)", FILES)?.hunkId).toBe("F2h1");
	});

	it("does not match a hunk id inside a longer one", () => {
		expect(resolveEntryPoint("Look at F1h12.", FILES)?.hunkId).toBe("F1h12");
	});

	it("returns null when nothing in the text belongs to this round", () => {
		expect(resolveEntryPoint("Start wherever you like.", FILES)).toBeNull();
	});

	it("returns null for an empty suggestion", () => {
		expect(resolveEntryPoint("", FILES)).toBeNull();
	});
});
