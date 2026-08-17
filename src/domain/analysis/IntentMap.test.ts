import { describe, expect, it } from "vitest";
import type { DiffLine } from "../changeset/DiffLine";
import type { FileDiff } from "../changeset/FileDiff";
import type { Hunk } from "../changeset/Hunk";
import { type IntentMap, intentMapClusterSizes } from "./IntentMap";

function makeHunk(id: string, addCount: number, delCount: number): Hunk {
	const lines: DiffLine[] = [
		{ type: "context", content: "context line", oldLine: 1, newLine: 1 },
		...Array.from({ length: delCount }, (_, index) => ({
			type: "del" as const,
			content: `deleted ${index}`,
			oldLine: 2 + index,
		})),
		...Array.from({ length: addCount }, (_, index) => ({
			type: "add" as const,
			content: `added ${index}`,
			newLine: 2 + index,
		})),
	];
	return {
		id,
		header: "",
		oldStart: 1,
		oldLines: 1 + delCount,
		newStart: 1,
		newLines: 1 + addCount,
		lines,
	};
}

function makeFile(path: string, hunks: Hunk[]): FileDiff {
	const additions = hunks.reduce(
		(sum, hunk) =>
			sum + hunk.lines.filter((line) => line.type === "add").length,
		0,
	);
	const deletions = hunks.reduce(
		(sum, hunk) =>
			sum + hunk.lines.filter((line) => line.type === "del").length,
		0,
	);
	return {
		id: `f_${path.replace(/\W/g, "").slice(0, 12)}`,
		path,
		status: "modified",
		additions,
		deletions,
		isBinary: false,
		isGenerated: false,
		oldBlob: { kind: "odb", oid: "oid-old" },
		newBlob: { kind: "odb", oid: "oid-new" },
		hunks,
	};
}

// core.ts: h1 = 6 changed lines, h2 = 4; tests.ts: h3 = 10
const FILES = [
	makeFile("src/core.ts", [makeHunk("h1", 4, 2), makeHunk("h2", 4, 0)]),
	makeFile("test/core.test.ts", [makeHunk("h3", 10, 0)]),
];

function makeMap(clusters: IntentMap["clusters"]): IntentMap {
	return {
		summary: "adds a feature and its tests",
		clusters,
		suggestedEntryPoint: "src/core.ts",
	};
}

describe("intentMapClusterSizes", () => {
	it("sizes clusters by their share of changed lines", () => {
		const map = makeMap([
			{
				name: "feature",
				kind: "core",
				description: "the change itself",
				members: [{ path: "src/core.ts", hunkIds: ["h1", "h2"] }],
			},
			{
				name: "tests",
				kind: "tests",
				description: "coverage for it",
				members: [{ path: "test/core.test.ts", hunkIds: ["h3"] }],
			},
		]);
		expect(intentMapClusterSizes(map, FILES)).toEqual([0.5, 0.5]);
	});

	it("counts only the hunks a member names", () => {
		const map = makeMap([
			{
				name: "first hunk only",
				kind: "core",
				description: "",
				members: [{ path: "src/core.ts", hunkIds: ["h1"] }],
			},
			{
				name: "second hunk only",
				kind: "core",
				description: "",
				members: [{ path: "src/core.ts", hunkIds: ["h2"] }],
			},
		]);
		expect(intentMapClusterSizes(map, FILES)).toEqual([0.6, 0.4]);
	});

	it("counts the whole file for a member without hunk precision", () => {
		const map = makeMap([
			{
				name: "everything in core",
				kind: "core",
				description: "",
				members: [{ path: "src/core.ts", hunkIds: [] }],
			},
			{
				name: "tests",
				kind: "tests",
				description: "",
				members: [{ path: "test/core.test.ts", hunkIds: ["h3"] }],
			},
		]);
		expect(intentMapClusterSizes(map, FILES)).toEqual([0.5, 0.5]);
	});

	it("counts nothing for a path the round does not contain", () => {
		const map = makeMap([
			{
				name: "phantom",
				kind: "chore",
				description: "",
				members: [{ path: "src/missing.ts", hunkIds: [] }],
			},
			{
				name: "tests",
				kind: "tests",
				description: "",
				members: [{ path: "test/core.test.ts", hunkIds: ["h3"] }],
			},
		]);
		expect(intentMapClusterSizes(map, FILES)).toEqual([0, 1]);
	});

	it("returns all zeros when the clusters cover no changed lines", () => {
		const map = makeMap([
			{
				name: "phantom",
				kind: "chore",
				description: "",
				members: [{ path: "src/missing.ts", hunkIds: [] }],
			},
		]);
		expect(intentMapClusterSizes(map, FILES)).toEqual([0]);
	});

	it("returns an empty array for an empty cluster list", () => {
		expect(intentMapClusterSizes(makeMap([]), FILES)).toEqual([]);
	});
});
