import { describe, expect, it } from "vitest";
import { placedFileId } from "./placedFileId";

describe("the file a placement belongs to", () => {
	it("is the placed file for anything the diff could anchor", () => {
		expect(
			placedFileId({ kind: "exact", fileId: "file-1", side: "new", line: 3 }),
		).toBe("file-1");
		expect(
			placedFileId({
				kind: "clamped",
				fileId: "file-2",
				side: "old",
				line: 1,
				requestedStartLine: 9,
				requestedEndLine: 9,
			}),
		).toBe("file-2");
	});

	it("is nothing when the diff cannot anchor it", () => {
		expect(placedFileId({ kind: "unplaceable" })).toBeNull();
	});
});
