import type { FileDiffDto } from "@dto/ChangesetDto";
import { describe, expect, it } from "vitest";
import { chatContextFromCursor } from "./chatContextFromCursor";

function file(path: string, hunkIds: readonly string[]): FileDiffDto {
	return {
		id: `id-${path}`,
		path,
		status: "modified",
		additions: 1,
		deletions: 0,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: null,
		hunks: hunkIds.map((id) => ({
			id,
			header: "@@",
			oldStart: 1,
			oldLines: 1,
			newStart: 1,
			newLines: 1,
			lines: [],
		})),
	};
}

const files = [
	file("src/greeting.ts", ["h1", "h2"]),
	file("assets/logo.png", []),
];

describe("chatContextFromCursor", () => {
	it("frames the question with the file and hunk under the cursor", () => {
		expect(
			chatContextFromCursor(files, { fileIndex: 0, hunkIndex: 1 }),
		).toEqual({
			file: "src/greeting.ts",
			hunkId: "h2",
		});
	});

	it("frames by file alone when the file holds no hunks", () => {
		expect(
			chatContextFromCursor(files, { fileIndex: 1, hunkIndex: 0 }),
		).toEqual({
			file: "assets/logo.png",
		});
	});

	it("frames with nothing when the cursor points nowhere", () => {
		expect(chatContextFromCursor([], { fileIndex: 0, hunkIndex: 0 })).toEqual(
			{},
		);
		expect(
			chatContextFromCursor(files, { fileIndex: 9, hunkIndex: 0 }),
		).toEqual({});
	});
});
