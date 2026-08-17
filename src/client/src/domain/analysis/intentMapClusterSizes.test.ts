import type { FileDiffDto } from "@dto/ChangesetDto";
import type { IntentMapDto } from "@dto/IntentMapDto";
import { describe, expect, it } from "vitest";
import { intentMapClusterSizes } from "./intentMapClusterSizes";

function file(
	path: string,
	changedLinesPerHunk: readonly number[],
): FileDiffDto {
	const hunks = changedLinesPerHunk.map((changedLines, index) => ({
		id: `F1h${index + 1}`,
		header: "@@",
		oldStart: 1,
		oldLines: 0,
		newStart: 1,
		newLines: changedLines,
		lines: Array.from({ length: changedLines }, () => ({
			type: "add" as const,
			content: "x",
		})),
	}));
	const additions = changedLinesPerHunk.reduce((sum, count) => sum + count, 0);
	return {
		id: path,
		path,
		status: "modified",
		additions,
		deletions: 0,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: null,
		hunks,
	};
}

function intentMap(clusters: IntentMapDto["clusters"]): IntentMapDto {
	return { summary: "s", clusters, suggestedEntryPoint: "" };
}

function cluster(
	name: string,
	members: IntentMapDto["clusters"][number]["members"],
): IntentMapDto["clusters"][number] {
	return { name, kind: "core", description: "d", members };
}

describe("intentMapClusterSizes", () => {
	it("splits the change by the hunks each cluster names", () => {
		const files = [file("src/a.ts", [30, 10]), file("src/b.ts", [10])];
		const map = intentMap([
			cluster("real change", [{ path: "src/a.ts", hunkIds: ["F1h1"] }]),
			cluster("fallout", [
				{ path: "src/a.ts", hunkIds: ["F1h2"] },
				{ path: "src/b.ts", hunkIds: ["F1h1"] },
			]),
		]);

		expect(intentMapClusterSizes(map, files)).toEqual([0.6, 0.4]);
	});

	it("counts a member without hunk ids as its whole file", () => {
		const files = [file("src/a.ts", [3]), file("src/b.ts", [1])];
		const map = intentMap([
			cluster("all of a", [{ path: "src/a.ts", hunkIds: [] }]),
			cluster("all of b", [{ path: "src/b.ts", hunkIds: [] }]),
		]);

		expect(intentMapClusterSizes(map, files)).toEqual([0.75, 0.25]);
	});

	it("counts nothing for a path this round does not contain", () => {
		const map = intentMap([
			cluster("known", [{ path: "src/a.ts", hunkIds: [] }]),
			cluster("gone", [{ path: "src/vanished.ts", hunkIds: [] }]),
		]);

		expect(intentMapClusterSizes(map, [file("src/a.ts", [4])])).toEqual([1, 0]);
	});

	it("returns all zeros rather than dividing by zero", () => {
		const map = intentMap([cluster("empty", [])]);

		expect(intentMapClusterSizes(map, [])).toEqual([0]);
	});

	it("has one entry per cluster, in cluster order", () => {
		const map = intentMap([
			cluster("first", []),
			cluster("second", [{ path: "src/a.ts", hunkIds: [] }]),
			cluster("third", []),
		]);

		expect(intentMapClusterSizes(map, [file("src/a.ts", [2])])).toEqual([
			0, 1, 0,
		]);
	});
});
