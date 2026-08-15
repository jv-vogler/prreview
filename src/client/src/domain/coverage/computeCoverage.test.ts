import type { FileDiffDto } from "@dto/ChangesetDto";
import { describe, expect, it } from "vitest";
import { computeCoverage } from "./computeCoverage";

function fileWithHunks(fileId: string, hunkIds: string[]): FileDiffDto {
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
		hunks: hunkIds.map((id) => ({
			id,
			header: "@@ -1,1 +1,1 @@",
			oldStart: 1,
			oldLines: 1,
			newStart: 1,
			newLines: 1,
			lines: [{ type: "context", content: "x", oldLine: 1, newLine: 1 }],
		})),
	};
}

describe("computeCoverage (server-semantics mirror)", () => {
	it("computes per-file and total percent over hunkIds", () => {
		const summary = computeCoverage(
			[
				fileWithHunks("f_aaa", ["h1", "h2"]),
				fileWithHunks("f_bbb", ["h3", "h4"]),
			],
			{ h1: "viewed", h2: "reviewed", h3: "viewed" },
		);
		expect(summary.byFile.f_aaa).toBe(100);
		expect(summary.byFile.f_bbb).toBe(50);
		expect(summary.total).toBe(75);
	});

	it("treats absent hunks as unseen", () => {
		const summary = computeCoverage([fileWithHunks("f_aaa", ["h1"])], {});
		expect(summary.total).toBe(0);
	});

	it("reports hunkless files (binary, mode-only) as fully covered", () => {
		const summary = computeCoverage(
			[fileWithHunks("f_bin", []), fileWithHunks("f_src", ["h1"])],
			{},
		);
		expect(summary.byFile.f_bin).toBe(100);
		expect(summary.total).toBe(0);
	});

	it("reports an empty changeset as fully covered", () => {
		expect(computeCoverage([], {}).total).toBe(100);
	});
});
