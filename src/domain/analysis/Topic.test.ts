import { describe, expect, it } from "vitest";
import vectors from "../../../test/vectors/topicSizing.json" with {
	type: "json",
};
import type { DiffLine } from "../changeset/DiffLine";
import type { FileDiff } from "../changeset/FileDiff";
import type { Hunk } from "../changeset/Hunk";
import { type Topic, topicCoverageFractions, uncoveredHunks } from "./Topic";

/**
 * The vectors are shared with the client twin
 * (src/client/src/domain/analysis/topicCoverage.test.ts) so the two copies of
 * this arithmetic cannot drift. Both build their own typed fixtures from the
 * same JSON numbers.
 */

interface HunkSpec {
	id: string;
	added: number;
	deleted: number;
}

function makeHunk(spec: HunkSpec): Hunk {
	const lines: DiffLine[] = [
		{ type: "context", content: "context line", oldLine: 1, newLine: 1 },
		...Array.from({ length: spec.deleted }, (_, index) => ({
			type: "del" as const,
			content: `deleted ${index}`,
			oldLine: 2 + index,
		})),
		...Array.from({ length: spec.added }, (_, index) => ({
			type: "add" as const,
			content: `added ${index}`,
			newLine: 2 + index,
		})),
	];
	return {
		id: spec.id,
		header: "",
		oldStart: 1,
		oldLines: 1 + spec.deleted,
		newStart: 1,
		newLines: 1 + spec.added,
		lines,
	};
}

function makeFile(path: string, hunkSpecs: HunkSpec[]): FileDiff {
	const hunks = hunkSpecs.map(makeHunk);
	return {
		id: `f_${path.replace(/\W/g, "").slice(0, 12)}`,
		path,
		status: "modified",
		additions: hunkSpecs.reduce((sum, spec) => sum + spec.added, 0),
		deletions: hunkSpecs.reduce((sum, spec) => sum + spec.deleted, 0),
		isBinary: false,
		isGenerated: false,
		oldBlob: { kind: "odb", oid: "oid-old" },
		newBlob: { kind: "odb", oid: "oid-new" },
		hunks,
	};
}

const FILES: FileDiff[] = vectors.files.map((file) =>
	makeFile(file.path, file.hunks),
);

function makeTopics(
	specs: { id: string; refs: { path: string; hunkIds: string[] }[] }[],
): Topic[] {
	return specs.map((spec) => ({
		id: spec.id,
		title: `topic ${spec.id}`,
		summary: "what this part of the change is trying to do",
		kind: "core" as const,
		refs: spec.refs,
	}));
}

describe("topicCoverageFractions", () => {
	it("uses the changeset's changed lines as the denominator", () => {
		const total = FILES.reduce(
			(sum, file) => sum + file.additions + file.deletions,
			0,
		);
		expect(total).toBe(vectors.changesetChangedLines);
	});

	for (const testCase of vectors.cases) {
		it(testCase.name, () => {
			const actual = topicCoverageFractions(makeTopics(testCase.topics), FILES);
			expect(actual).toHaveLength(testCase.expected.length);
			for (const [index, expected] of testCase.expected.entries()) {
				expect(actual[index]).toBeCloseTo(expected, 10);
			}
		});
	}

	/**
	 * The regression the fix exists for, stated as its own assertion so that
	 * reintroducing the sum-over-topics denominator fails here by name rather
	 * than as an opaque number mismatch.
	 */
	it("does not normalize by the sum over topics, which overlap would distort", () => {
		const overlapping = vectors.cases.find((testCase) =>
			testCase.name.startsWith("OVERLAP"),
		);
		if (overlapping === undefined) {
			throw new Error("the overlap vector is missing");
		}
		const actual = topicCoverageFractions(
			makeTopics(overlapping.topics),
			FILES,
		);
		const broken = overlapping.oldBrokenExpected ?? [];
		expect(actual[0]).not.toBeCloseTo(broken[0] ?? -1, 10);
		expect(actual[1]).not.toBeCloseTo(broken[1] ?? -1, 10);
		// and the fractions are free to exceed 1 in sum, because topics overlap
		expect(actual.reduce((sum, value) => sum + value, 0)).toBeCloseTo(0.8, 10);
	});

	it("returns zeros rather than dividing by zero on an empty changeset", () => {
		expect(
			topicCoverageFractions(
				makeTopics([{ id: "t1", refs: [{ path: "a.ts", hunkIds: [] }] }]),
				[],
			),
		).toEqual([0]);
	});
});

describe("uncoveredHunks", () => {
	for (const testCase of vectors.uncoveredCases) {
		it(testCase.name, () => {
			expect(uncoveredHunks(makeTopics(testCase.topics), FILES)).toEqual(
				testCase.expected,
			);
		});
	}
});
