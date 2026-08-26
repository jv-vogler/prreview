import { describe, expect, it } from "vitest";
import { loadDiffFixture } from "../../../test/helpers/loadDiffFixture";
import { buildLineIndex } from "./LineIndex";
import { parseDiff } from "./parseDiff";

describe("buildLineIndex", () => {
	it("maps every diff line on both sides to its hunk id", () => {
		const [file] = parseDiff(loadDiffFixture("duplicate-hunks.patch"));
		const index = buildLineIndex(file);
		const [firstHunk, secondHunk] = file.hunks;

		expect(index.newLines.get(2)).toBe(firstHunk.id);
		expect(index.newLines.get(5)).toBe(firstHunk.id);
		expect(index.newLines.get(8)).toBe(firstHunk.id);
		expect(index.oldLines.get(5)).toBe(firstHunk.id);
		expect(index.newLines.get(13)).toBe(secondHunk.id);
		expect(index.oldLines.get(13)).toBe(secondHunk.id);
	});

	it("answers 'not part of the diff' for lines outside every hunk", () => {
		const [file] = parseDiff(loadDiffFixture("duplicate-hunks.patch"));
		const index = buildLineIndex(file);
		expect(index.newLines.get(1)).toBeUndefined();
		expect(index.newLines.get(9)).toBeUndefined();
		expect(index.newLines.get(17)).toBeUndefined();
	});

	it("indexes added lines on the new side only", () => {
		const [file] = parseDiff(loadDiffFixture("add.patch"));
		const index = buildLineIndex(file);
		expect(index.oldLines.size).toBe(0);
		expect(index.newLines.size).toBe(3);
		expect(index.newLines.get(1)).toBe(file.hunks[0].id);
	});

	it("indexes deleted lines on the old side only", () => {
		const [file] = parseDiff(loadDiffFixture("delete.patch"));
		const index = buildLineIndex(file);
		expect(index.newLines.size).toBe(0);
		expect(index.oldLines.size).toBe(3);
	});

	it("is empty for hunkless files", () => {
		const [file] = parseDiff(loadDiffFixture("binary.patch"));
		const index = buildLineIndex(file);
		expect(index.oldLines.size).toBe(0);
		expect(index.newLines.size).toBe(0);
	});
});
