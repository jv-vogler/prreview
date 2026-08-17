import { describe, expect, it } from "vitest";
import type { ChangesetRef } from "../../domain/changeset/ChangesetRef";
import type { DiffLine } from "../../domain/changeset/DiffLine";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { NUD_GLOBAL_LINE_CAP, NUD_PER_FILE_LINE_CAP } from "./limits";
import { serializeNud } from "./nud";
import { truncate } from "./truncate";

function makeFile(
	path: string,
	changedLineCount: number,
	overrides?: Partial<FileDiff>,
): FileDiff {
	const lines: DiffLine[] = Array.from(
		{ length: changedLineCount },
		(_, index): DiffLine => ({
			type: "add",
			content: `line ${index + 1}`,
			newLine: index + 1,
		}),
	);
	return {
		id: `f_${path}`,
		path,
		status: "added",
		additions: changedLineCount,
		deletions: 0,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: { kind: "odb", oid: "0".repeat(40) },
		hunks: [
			{
				id: `${path}-h1`,
				header: `@@ -0,0 +1,${changedLineCount} @@`,
				oldStart: 0,
				oldLines: 0,
				newStart: 1,
				newLines: changedLineCount,
				lines,
			},
		],
		...overrides,
	};
}

describe("truncate", () => {
	it("collapses generated files to stat entries regardless of size", () => {
		const generated = makeFile("package-lock.json", 5000, {
			isGenerated: true,
		});
		const source = makeFile("src/a.ts", 10);
		const result = truncate([generated, source]);
		expect(result.statOnly).toEqual([generated]);
		expect(result.included.map(({ file }) => file)).toEqual([source]);
		expect(result.truncated).toEqual([]);
	});

	it("marks a file over the per-file cap for cutting, leaving smaller ones whole", () => {
		const big = makeFile("src/big.ts", NUD_PER_FILE_LINE_CAP + 1);
		const exact = makeFile("src/exact.ts", NUD_PER_FILE_LINE_CAP);
		const result = truncate([big, exact]);
		expect(result.included).toEqual([
			{ file: big, cutAtChangedLines: NUD_PER_FILE_LINE_CAP },
			{ file: exact },
		]);
	});

	it("drops whole files past the global cap, test files before source files", () => {
		const testFile = makeFile("test/suite.test.ts", NUD_PER_FILE_LINE_CAP);
		const sourceFiles = Array.from({ length: 8 }, (_, index) =>
			makeFile(`src/module-${index}.ts`, NUD_PER_FILE_LINE_CAP),
		);
		// listed first, yet the 8 source files (8 × 400 = 3200 ≥ 3000) win the budget
		const result = truncate([testFile, ...sourceFiles]);
		expect(result.included.map(({ file }) => file)).toEqual(sourceFiles);
		expect(result.truncated).toEqual([testFile]);
	});

	it("admits files softly: the file that crosses the cap is still included", () => {
		const first = makeFile("src/first.ts", NUD_GLOBAL_LINE_CAP - 1);
		// first spends 400 (capped per file), so everything up to the budget fits
		const files = [
			first,
			...Array.from({ length: 7 }, (_, index) =>
				makeFile(`src/rest-${index}.ts`, NUD_PER_FILE_LINE_CAP),
			),
		];
		const result = truncate(files);
		// 8 × 400 = 3200: the 8th file is admitted while spent is 2800 < 3000
		expect(result.included).toHaveLength(8);
		expect(result.truncated).toEqual([]);
	});

	it("keeps the changeset's original file order in `included`", () => {
		const testFile = makeFile("test/a.test.ts", 10);
		const source = makeFile("src/z.ts", 10);
		const result = truncate([testFile, source]);
		expect(result.included.map(({ file }) => file.path)).toEqual([
			"test/a.test.ts",
			"src/z.ts",
		]);
	});
});

const REF: ChangesetRef = {
	source: { kind: "branch", branch: "feature-x", base: "main" },
	baseSha: "a".repeat(40),
	headSha: "b".repeat(40),
	resolvedAt: "2026-08-17T00:00:00.000Z",
};

describe("truncation rendering in the NUD", () => {
	it("cuts an oversized file at the cap and emits the literal marker", () => {
		const big = makeFile("src/big.ts", NUD_PER_FILE_LINE_CAP + 50);
		const nud = serializeNud({ ref: REF, roundId: "r1", files: [big] });
		const lines = nud.split("\n");
		const markerIndex = lines.indexOf(
			"... truncated — Read src/big.ts in the workspace for the rest",
		);
		expect(markerIndex).toBeGreaterThan(-1);
		const emittedRows = lines.filter((line) => line.includes(" | +"));
		expect(emittedRows).toHaveLength(NUD_PER_FILE_LINE_CAP);
		expect(lines[markerIndex - 1]).toContain(`+line ${NUD_PER_FILE_LINE_CAP}`);
	});

	it("lists generated and dropped files with their markers, never their lines", () => {
		const generated = makeFile("dist/bundle.min.js", 2000, {
			isGenerated: true,
		});
		const sourceFiles = Array.from({ length: 8 }, (_, index) =>
			makeFile(`src/module-${index}.ts`, NUD_PER_FILE_LINE_CAP),
		);
		const dropped = makeFile("test/dropped.test.ts", 100);
		const nud = serializeNud({
			ref: REF,
			roundId: "r1",
			files: [generated, ...sourceFiles, dropped],
		});
		expect(nud).toContain("dist/bundle.min.js");
		expect(nud).toContain("[generated — stat only]");
		expect(nud).toContain(
			"test/dropped.test.ts  (added, +100 −0)  [not shown]",
		);
		expect(nud).not.toContain("=== FILE f_dist/bundle.min.js");
		expect(nud).not.toContain("=== FILE f_test/dropped.test.ts");
	});
});
