import { describe, expect, it } from "vitest";
import type { LineIndex } from "../changeset/LineIndex";
import type { Anchor } from "./Anchor";
import { captureSnapshot } from "./captureSnapshot";
import { type ReanchorInput, type ReanchorResult, reanchor } from "./reanchor";

const BASE = [
	"import { readFile } from 'node:fs';", // 1
	"", // 2
	"export function loadConfig(path) {", // 3
	"  const raw = readFile(path);", // 4
	"  return JSON.parse(raw);", // 5
	"}", // 6
	"", // 7
	"export function saveConfig(path, data) {", // 8
	"  const text = JSON.stringify(data);", // 9
	"  writeFile(path, text);", // 10
	"}", // 11
];

const EMPTY_INDEX: LineIndex = { oldLines: new Map(), newLines: new Map() };

function indexOnNewSide(start: number, end: number): LineIndex {
	const newLines = new Map<number, string>();
	for (let line = start; line <= end; line++) {
		newLines.set(line, "hunk-x");
	}
	return { oldLines: new Map(), newLines };
}

function makeAnchor(
	lines: string[],
	startLine: number,
	endLine: number,
	blobOid: string,
): Anchor {
	return {
		fileId: "f_a1b2c3d4e5f6",
		path: "src/config/load.ts",
		side: "new",
		startLine,
		endLine,
		placement: "in-diff",
		snapshot: captureSnapshot(lines, startLine, endLine, blobOid),
	};
}

function runReanchor(
	anchor: Anchor,
	oldLines: string[],
	newLines: string[],
	options?: Partial<ReanchorInput["newFile"]> & { lineIndex?: LineIndex },
): ReanchorResult {
	return reanchor({
		anchor,
		oldLines,
		newFile: {
			fileId: options?.fileId ?? anchor.fileId,
			path: options?.path ?? anchor.path,
			blobOid: options?.blobOid ?? "oid-new",
			lines: newLines,
		},
		newLineIndex: options?.lineIndex ?? EMPTY_INDEX,
	});
}

describe("reanchor", () => {
	it("step 1: blob-oid identity leaves the anchor unchanged", () => {
		const anchor = makeAnchor(BASE, 4, 5, "oid-base");
		const result = runReanchor(anchor, BASE, BASE, {
			blobOid: "oid-base",
			lineIndex: indexOnNewSide(4, 5),
		});
		expect(result.status).toBe("anchored");
		expect(result.touchedByDelta).toBe(false);
		expect(result.anchor).toEqual(anchor);
	});

	it("step 2: an indentation-only edit survives via normalization", () => {
		const anchor = makeAnchor(BASE, 4, 5, "oid-base");
		const reindented = BASE.map((line, index) =>
			index === 3 || index === 4 ? `  ${line}` : line,
		);
		const result = runReanchor(anchor, BASE, reindented);
		expect(result.status).toBe("anchored");
		expect(result.touchedByDelta).toBe(false);
		expect(result.anchor.startLine).toBe(4);
		expect(result.anchor.endLine).toBe(5);
		expect(result.anchor.snapshot.blobOid).toBe("oid-new");
		expect(result.anchor.snapshot.lineHash).toBe(anchor.snapshot.lineHash);
	});

	it("step 3: a pure shift (lines added above) translates the anchor", () => {
		const anchor = makeAnchor(BASE, 4, 5, "oid-base");
		const shifted = ["// header", "// more header", "// even more", ...BASE];
		const result = runReanchor(anchor, BASE, shifted, {
			lineIndex: indexOnNewSide(7, 8),
		});
		expect(result.status).toBe("moved");
		expect(result.touchedByDelta).toBe(false);
		expect(result.anchor.startLine).toBe(7);
		expect(result.anchor.endLine).toBe(8);
		expect(result.anchor.placement).toBe("in-diff");
		expect(result.anchor.snapshot.targetLines).toEqual(
			anchor.snapshot.targetLines,
		);
	});

	it("finds a moved block", () => {
		const anchor = makeAnchor(BASE, 4, 5, "oid-base");
		const blockMoved = [
			"import { readFile } from 'node:fs';",
			"",
			"export function saveConfig(path, data) {",
			"  const text = JSON.stringify(data);",
			"  writeFile(path, text);",
			"}",
			"",
			"export function loadConfig(path) {",
			"  const raw = readFile(path);",
			"  return JSON.parse(raw);",
			"}",
		];
		const result = runReanchor(anchor, BASE, blockMoved);
		expect(result.status).toBe("moved");
		expect(result.anchor.startLine).toBe(9);
		expect(result.anchor.endLine).toBe(10);
	});

	it("step 4: finds a block that moved and was reindented, via exact-content search", () => {
		const anchor = makeAnchor(BASE, 4, 5, "oid-base");
		const movedReindented = [
			"import { readFile } from 'node:fs';",
			"",
			"export function saveConfig(path, data) {",
			"  const text = JSON.stringify(data);",
			"  writeFile(path, text);",
			"}",
			"",
			"export function loadConfig(path) {",
			"\tconst raw = readFile(path);",
			"\treturn JSON.parse(raw);",
			"}",
		];
		const result = runReanchor(anchor, BASE, movedReindented);
		expect(result.status).toBe("moved");
		expect(result.touchedByDelta).toBe(false);
		expect(result.anchor.startLine).toBe(9);
		expect(result.anchor.endLine).toBe(10);
	});

	it("step 4: picks between duplicates when context puts one clearly ahead", () => {
		const contextOld = [
			"alpha",
			"beta",
			"gamma",
			"    dup line",
			"delta",
			"epsilon",
			"zeta",
		];
		const anchor = makeAnchor(contextOld, 4, 4, "oid-base");
		const contextNew = [
			"\tdup line", // candidate with no matching context
			"other1",
			"other2",
			"alpha",
			"beta",
			"gamma",
			"\tdup line", // candidate with all 6 context lines matching
			"delta",
			"epsilon",
			"zeta",
		];
		const result = runReanchor(anchor, contextOld, contextNew);
		expect(result.status).toBe("moved");
		expect(result.anchor.startLine).toBe(7);
		expect(result.anchor.endLine).toBe(7);
	});

	it("refuses to guess between near-identical candidates and falls through to fuzzy", () => {
		const duplicateOld = [
			"header one",
			"header two",
			"    target line one",
			"    target line two",
			"footer one",
			"footer two",
		];
		const anchor = makeAnchor(duplicateOld, 3, 4, "oid-base");
		const duplicateNew = [
			"intro",
			"\ttarget line one",
			"\ttarget line two",
			"separator",
			"\ttarget line one",
			"\ttarget line two",
			"outro",
		];
		const result = runReanchor(anchor, duplicateOld, duplicateNew);
		expect(result.status).toBe("fuzzy");
		expect(result.touchedByDelta).toBe(true);
		// deterministic tie-break: the candidate nearest the predicted position
		expect(result.anchor.startLine).toBe(2);
		expect(result.anchor.endLine).toBe(3);
	});

	it("handles a rename plus edit, updating the anchor's file identity", () => {
		const anchor = makeAnchor(BASE, 4, 5, "oid-base");
		const renamedAndEdited = [
			"// moved to src/config.ts",
			...BASE.map((line, index) =>
				index === 8 ? "  const text = JSON.stringify(data, null, 2);" : line,
			),
		];
		const result = runReanchor(anchor, BASE, renamedAndEdited, {
			fileId: "f_ffffffffffff",
			path: "src/config.ts",
		});
		expect(result.status).toBe("moved");
		expect(result.anchor.fileId).toBe("f_ffffffffffff");
		expect(result.anchor.path).toBe("src/config.ts");
		expect(result.anchor.startLine).toBe(5);
		expect(result.anchor.endLine).toBe(6);
	});

	it("step 5: lands an edited line exactly at the ±40 boundary", () => {
		const fuzzyOld = [
			"// preamble",
			"const total = price * quantity;",
			"// tail",
		];
		const anchor = makeAnchor(fuzzyOld, 2, 2, "oid-base");
		const fillerCount = 40;
		const fillers = Array.from(
			{ length: fillerCount },
			(_, index) => `// filler ${index}`,
		);
		const fuzzyNew = [
			"// preamble",
			...fillers,
			"const total = price * quantityX;",
			"// tail changed",
		];
		const result = runReanchor(anchor, fuzzyOld, fuzzyNew);
		expect(result.status).toBe("fuzzy");
		expect(result.touchedByDelta).toBe(true);
		expect(result.anchor.startLine).toBe(fillerCount + 2);
		expect(result.anchor.snapshot.targetLines).toEqual([
			"const total = price * quantityX;",
		]);
	});

	it("step 6: one line past the ±40 window is orphaned", () => {
		const fuzzyOld = [
			"// preamble",
			"const total = price * quantity;",
			"// tail",
		];
		const anchor = makeAnchor(fuzzyOld, 2, 2, "oid-base");
		const fillers = Array.from(
			{ length: 41 },
			(_, index) => `// filler ${index}`,
		);
		const beyondWindow = [
			"// preamble",
			...fillers,
			"const total = price * quantityX;",
			"// tail changed",
		];
		const result = runReanchor(anchor, fuzzyOld, beyondWindow);
		expect(result.status).toBe("orphaned");
	});

	it("step 6: a deleted target is orphaned and the anchor kept as-is", () => {
		const anchor = makeAnchor(BASE, 4, 5, "oid-base");
		const bodyDeleted = [...BASE.slice(0, 3), ...BASE.slice(5)];
		const result = runReanchor(anchor, BASE, bodyDeleted);
		expect(result.status).toBe("orphaned");
		expect(result.touchedByDelta).toBe(false);
		expect(result.anchor).toBe(anchor);
		expect(result.anchor.snapshot.blobOid).toBe("oid-base");
	});

	it("follows the file for a file-level anchor whose blob changed", () => {
		const anchor = makeAnchor(BASE, 0, 0, "oid-base");
		const edited = BASE.map((line, index) =>
			index === 0 ? "import { readFile } from 'fs';" : line,
		);
		const result = runReanchor(anchor, BASE, edited);
		expect(result.status).toBe("anchored");
		expect(result.anchor.startLine).toBe(0);
		expect(result.anchor.endLine).toBe(0);
		expect(result.anchor.placement).toBe("file-level");
		expect(result.anchor.snapshot.blobOid).toBe("oid-new");
	});

	it("is deterministic: the same matrix run twice yields identical output", () => {
		const anchor = makeAnchor(BASE, 4, 5, "oid-base");
		const shifted = ["// header", ...BASE];
		const bodyDeleted = [...BASE.slice(0, 3), ...BASE.slice(5)];
		const scenarios = [shifted, bodyDeleted, BASE];
		const firstRun = scenarios.map((newLines) =>
			runReanchor(anchor, BASE, newLines),
		);
		const secondRun = scenarios.map((newLines) =>
			runReanchor(anchor, BASE, newLines),
		);
		expect(secondRun).toEqual(firstRun);
	});

	it("is idempotent: re-anchoring a landed anchor onto the same blob is exact", () => {
		const anchor = makeAnchor(BASE, 4, 5, "oid-base");
		const shifted = ["// header", "// more header", "// even more", ...BASE];
		const landed = runReanchor(anchor, BASE, shifted);
		const again = reanchor({
			anchor: landed.anchor,
			oldLines: shifted,
			newFile: {
				fileId: landed.anchor.fileId,
				path: landed.anchor.path,
				blobOid: "oid-new",
				lines: shifted,
			},
			newLineIndex: EMPTY_INDEX,
		});
		expect(again.status).toBe("anchored");
		expect(again.anchor).toEqual(landed.anchor);
	});
});
