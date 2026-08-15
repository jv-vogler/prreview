import { describe, expect, it } from "vitest";
import type { FileDiff } from "../changeset/FileDiff";
import type { Hunk } from "../changeset/Hunk";
import { carryCoverage } from "./carryCoverage";

function hunk(id: string): Hunk {
	return {
		id,
		header: "@@ -1,1 +1,1 @@",
		oldStart: 1,
		oldLines: 1,
		newStart: 1,
		newLines: 1,
		lines: [{ type: "context", content: "x", oldLine: 1, newLine: 1 }],
	};
}

function fileWithHunks(fileId: string, hunkIds: string[]): FileDiff {
	return {
		id: fileId,
		path: `${fileId}.txt`,
		status: "modified",
		additions: 0,
		deletions: 0,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: null,
		hunks: hunkIds.map(hunk),
	};
}

describe("carryCoverage", () => {
	it("keeps state only for hunkIds that survive into the new round", () => {
		const carried = carryCoverage(
			{ h1: "reviewed", h2: "viewed", h3: "viewed" },
			[fileWithHunks("f_aaa", ["h1", "h3", "h4"])],
		);
		expect(carried).toEqual({ h1: "reviewed", h3: "viewed" });
	});

	it("carries across files: content identity, not file position", () => {
		const carried = carryCoverage({ h1: "reviewed" }, [
			fileWithHunks("f_other", ["h1"]),
		]);
		expect(carried).toEqual({ h1: "reviewed" });
	});

	it("leaves new hunks unseen by omission", () => {
		const carried = carryCoverage({}, [fileWithHunks("f_aaa", ["h9"])]);
		expect(carried).toEqual({});
	});

	it("returns nothing when the new round is empty", () => {
		const carried = carryCoverage({ h1: "reviewed" }, []);
		expect(carried).toEqual({});
	});

	it("does not mutate the previous record", () => {
		const previous = { h1: "reviewed" } as const;
		carryCoverage(previous, []);
		expect(previous).toEqual({ h1: "reviewed" });
	});
});
