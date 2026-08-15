import type { FileDiffDto } from "@dto/ChangesetDto";
import { describe, expect, it } from "vitest";
import { buildLineIndex } from "./buildLineIndex";

const file: FileDiffDto = {
	id: "f_abc",
	path: "src/app.ts",
	status: "modified",
	additions: 2,
	deletions: 1,
	isBinary: false,
	isGenerated: false,
	oldBlob: null,
	newBlob: null,
	hunks: [
		{
			id: "h1",
			header: "@@ -1,3 +1,3 @@",
			oldStart: 1,
			oldLines: 3,
			newStart: 1,
			newLines: 3,
			lines: [
				{ type: "context", content: "a", oldLine: 1, newLine: 1 },
				{ type: "del", content: "b", oldLine: 2 },
				{ type: "add", content: "c", newLine: 2 },
				{ type: "context", content: "d", oldLine: 3, newLine: 3 },
			],
		},
		{
			id: "h2",
			header: "@@ -10,1 +10,2 @@",
			oldStart: 10,
			oldLines: 1,
			newStart: 10,
			newLines: 2,
			lines: [
				{ type: "context", content: "e", oldLine: 10, newLine: 10 },
				{ type: "add", content: "f", newLine: 11 },
			],
		},
	],
};

describe("buildLineIndex", () => {
	it("maps both sides' line numbers to their hunk index", () => {
		const index = buildLineIndex(file);
		expect(index.oldLines.get(2)).toBe(0);
		expect(index.newLines.get(2)).toBe(0);
		expect(index.newLines.get(11)).toBe(1);
		expect(index.oldLines.get(10)).toBe(1);
	});

	it("leaves unlisted lines unmapped", () => {
		const index = buildLineIndex(file);
		expect(index.newLines.get(99)).toBeUndefined();
		expect(index.oldLines.has(11)).toBe(false);
	});
});
