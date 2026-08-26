import { describe, expect, it } from "vitest";
import type { FileDiff } from "../changeset/FileDiff";
import type { Hunk } from "../changeset/Hunk";
import { placeOnDiff } from "./placeOnDiff";

function file(overrides: Partial<FileDiff> = {}): FileDiff {
	return {
		id: "file-1",
		path: "src/greeting.ts",
		status: "modified",
		additions: 0,
		deletions: 0,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: null,
		hunks: [],
		...overrides,
	};
}

function hunk(overrides: Partial<Hunk> = {}): Hunk {
	return {
		id: "hunk-1",
		header: "",
		oldStart: 1,
		oldLines: 0,
		newStart: 1,
		newLines: 0,
		lines: [],
		...overrides,
	};
}

describe("placeOnDiff", () => {
	it("places a range that falls entirely inside one hunk as exact, on the new side", () => {
		const target = file({
			hunks: [
				hunk({
					lines: [
						{ type: "context", content: "a", oldLine: 1, newLine: 1 },
						{ type: "add", content: "b", newLine: 2 },
						{ type: "add", content: "c", newLine: 3 },
						{ type: "context", content: "d", oldLine: 2, newLine: 4 },
					],
				}),
			],
		});

		const placement = placeOnDiff(
			{ path: target.path, startLine: 2, endLine: 3 },
			[target],
		);

		expect(placement).toEqual({
			kind: "exact",
			fileId: "file-1",
			side: "new",
			line: 3,
		});
	});

	it("falls back to the old side when only the old side renders the full range", () => {
		const target = file({
			hunks: [
				hunk({
					lines: [
						{ type: "del", content: "removed one", oldLine: 5 },
						{ type: "del", content: "removed two", oldLine: 6 },
					],
				}),
			],
		});

		const placement = placeOnDiff(
			{ path: target.path, startLine: 5, endLine: 6 },
			[target],
		);

		expect(placement).toEqual({
			kind: "exact",
			fileId: "file-1",
			side: "old",
			line: 6,
		});
	});

	it("clamps a range spanning two hunks to the nearest rendered line", () => {
		const target = file({
			hunks: [
				hunk({
					id: "hunk-1",
					lines: [{ type: "add", content: "a", newLine: 2 }],
				}),
				hunk({
					id: "hunk-2",
					lines: [{ type: "add", content: "b", newLine: 40 }],
				}),
			],
		});

		// the requested range (2..40) crosses a gap of unrendered lines the
		// diff never carries, so it cannot be exact
		const placement = placeOnDiff(
			{ path: target.path, startLine: 2, endLine: 40 },
			[target],
		);

		expect(placement).toEqual({
			kind: "clamped",
			fileId: "file-1",
			side: "new",
			line: 40,
			requestedStartLine: 2,
			requestedEndLine: 40,
		});
	});

	it("clamps a range that spans non-diff lines within a single hunk's line numbers", () => {
		const target = file({
			hunks: [
				hunk({
					lines: [
						{ type: "add", content: "a", newLine: 10 },
						{ type: "add", content: "b", newLine: 11 },
						// 12 is unchanged and outside this hunk's context, so it is
						// not a rendered line even though 10, 11 and 13 are
						{ type: "add", content: "c", newLine: 13 },
					],
				}),
			],
		});

		const placement = placeOnDiff(
			{ path: target.path, startLine: 10, endLine: 13 },
			[target],
		);

		expect(placement).toEqual({
			kind: "clamped",
			fileId: "file-1",
			side: "new",
			line: 13,
			requestedStartLine: 10,
			requestedEndLine: 13,
		});
	});

	it("clamps a range entirely outside the diff to the closest rendered line", () => {
		const target = file({
			hunks: [
				hunk({
					lines: [
						{ type: "add", content: "a", newLine: 5 },
						{ type: "add", content: "b", newLine: 6 },
					],
				}),
			],
		});

		const placement = placeOnDiff(
			{ path: target.path, startLine: 100, endLine: 105 },
			[target],
		);

		expect(placement).toEqual({
			kind: "clamped",
			fileId: "file-1",
			side: "new",
			line: 6,
			requestedStartLine: 100,
			requestedEndLine: 105,
		});
	});

	it("answers unplaceable when the file is absent from the diff", () => {
		const target = file();

		const placement = placeOnDiff(
			{ path: "src/other.ts", startLine: 1, endLine: 1 },
			[target],
		);

		expect(placement).toEqual({ kind: "unplaceable" });
	});

	it("answers unplaceable against an empty diff", () => {
		const placement = placeOnDiff(
			{ path: "src/greeting.ts", startLine: 1, endLine: 1 },
			[],
		);

		expect(placement).toEqual({ kind: "unplaceable" });
	});

	it("answers unplaceable for a file present in the diff with no rendered lines", () => {
		const target = file({ isBinary: true, hunks: [] });

		const placement = placeOnDiff(
			{ path: target.path, startLine: 1, endLine: 1 },
			[target],
		);

		expect(placement).toEqual({ kind: "unplaceable" });
	});

	it("places a single-line file's only line exactly", () => {
		const target = file({
			hunks: [
				hunk({
					lines: [{ type: "add", content: "only line", newLine: 1 }],
				}),
			],
		});

		const placement = placeOnDiff(
			{ path: target.path, startLine: 1, endLine: 1 },
			[target],
		);

		expect(placement).toEqual({
			kind: "exact",
			fileId: "file-1",
			side: "new",
			line: 1,
		});
	});
});
