import { describe, expect, it } from "vitest";
import type { FileDiff } from "../changeset/FileDiff";
import type { Hunk } from "../changeset/Hunk";
import { computeCoverage } from "./computeCoverage";

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

describe("computeCoverage", () => {
	it("computes per-file and total percent over hunkIds", () => {
		const files = [
			fileWithHunks("f_aaa", ["h1", "h2"]),
			fileWithHunks("f_bbb", ["h3", "h4"]),
		];
		const summary = computeCoverage(files, {
			h1: "viewed",
			h2: "reviewed",
			h3: "viewed",
		});
		expect(summary.byFile.f_aaa).toBe(100);
		expect(summary.byFile.f_bbb).toBe(50);
		expect(summary.total).toBe(75);
	});

	it("treats hunks absent from the record as unseen", () => {
		const files = [fileWithHunks("f_aaa", ["h1", "h2"])];
		const summary = computeCoverage(files, {});
		expect(summary.byFile.f_aaa).toBe(0);
		expect(summary.total).toBe(0);
	});

	it("treats an explicit unseen the same as absence", () => {
		const files = [fileWithHunks("f_aaa", ["h1", "h2"])];
		const summary = computeCoverage(files, { h1: "unseen", h2: "viewed" });
		expect(summary.byFile.f_aaa).toBe(50);
	});

	it("counts a hunkless file as fully covered without skewing the total", () => {
		const files = [
			fileWithHunks("f_binary", []),
			fileWithHunks("f_code", ["h1", "h2"]),
		];
		const summary = computeCoverage(files, { h1: "viewed" });
		expect(summary.byFile.f_binary).toBe(100);
		expect(summary.byFile.f_code).toBe(50);
		expect(summary.total).toBe(50);
	});

	it("reports an empty changeset as fully covered", () => {
		const summary = computeCoverage([], {});
		expect(summary.total).toBe(100);
		expect(summary.byFile).toEqual({});
	});

	it("ignores states for hunks that are not in the changeset", () => {
		const files = [fileWithHunks("f_aaa", ["h1"])];
		const summary = computeCoverage(files, { stale: "reviewed" });
		expect(summary.total).toBe(0);
	});
});
