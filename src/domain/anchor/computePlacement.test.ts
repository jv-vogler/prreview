import { describe, expect, it } from "vitest";
import type { LineIndex } from "../changeset/LineIndex";
import { computePlacement } from "./computePlacement";

const BLOB_LINE_COUNT = 40;

/** two hunks on the new side (5–8 and 12–15) with an unchanged gap between */
function twoHunkIndex(): LineIndex {
	const newLines = new Map<number, string>();
	for (let line = 5; line <= 8; line++) {
		newLines.set(line, "hunk-1");
	}
	for (let line = 12; line <= 15; line++) {
		newLines.set(line, "hunk-2");
	}
	return { oldLines: new Map(), newLines };
}

describe("computePlacement", () => {
	it("is in-diff when every line of the range maps to a hunk on that side", () => {
		const placement = computePlacement({
			side: "new",
			startLine: 6,
			endLine: 8,
			lineIndex: twoHunkIndex(),
			blobLineCount: BLOB_LINE_COUNT,
		});
		expect(placement).toBe("in-diff");
	});

	it("is in-file when the range exists in the blob but not in a hunk", () => {
		const placement = computePlacement({
			side: "new",
			startLine: 20,
			endLine: 22,
			lineIndex: twoHunkIndex(),
			blobLineCount: BLOB_LINE_COUNT,
		});
		expect(placement).toBe("in-file");
	});

	it("is in-file for a range straddling two hunks across the gap", () => {
		const placement = computePlacement({
			side: "new",
			startLine: 7,
			endLine: 13,
			lineIndex: twoHunkIndex(),
			blobLineCount: BLOB_LINE_COUNT,
		});
		expect(placement).toBe("in-file");
	});

	it("is file-level for the 0/0 range", () => {
		const placement = computePlacement({
			side: "new",
			startLine: 0,
			endLine: 0,
			lineIndex: twoHunkIndex(),
			blobLineCount: BLOB_LINE_COUNT,
		});
		expect(placement).toBe("file-level");
	});

	it("falls back to file-level for a range outside the blob's bounds", () => {
		const placement = computePlacement({
			side: "new",
			startLine: 39,
			endLine: 45,
			lineIndex: twoHunkIndex(),
			blobLineCount: BLOB_LINE_COUNT,
		});
		expect(placement).toBe("file-level");
	});

	it("checks the requested side's index, not the other one", () => {
		const placement = computePlacement({
			side: "old",
			startLine: 6,
			endLine: 8,
			lineIndex: twoHunkIndex(),
			blobLineCount: BLOB_LINE_COUNT,
		});
		expect(placement).toBe("in-file");
	});
});
