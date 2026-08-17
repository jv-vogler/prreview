/**
 * Deterministic fixture generator: 32 files, 8 hunks each, ~5,500 diff lines
 * total. Old/new contents are generated first and the patch is derived from
 * them, so `loadDiffFiles` can serve full contents that stay consistent with
 * the hunks (context expansion must line up).
 */

export interface FixtureEdit {
	/** 1-based line in the OLD file where the edit starts. */
	oldStart: number;
	/** 1-based line in the NEW file where the first added line lands. */
	newStart: number;
	deletedCount: number;
	addedCount: number;
}

export interface FixtureFile {
	name: string;
	oldLines: string[];
	newLines: string[];
	edits: FixtureEdit[];
	patch: string;
}

const FILE_COUNT = 32;
const OLD_FILE_LENGTH = 210;
const EDIT_OLD_POSITIONS = [15, 40, 65, 90, 115, 140, 165, 190];
const DELETED_PER_EDIT = 6;
const ADDED_PER_EDIT = 8;
const CONTEXT_LINES = 3;

const EXTENSIONS = ["ts", "css", "json", "md"];

function contentLine(
	extension: string,
	fileIndex: number,
	lineNumber: number,
	generation: "old" | "new",
): string {
	const marker = generation === "old" ? "alpha" : "beta";
	switch (extension) {
		case "ts":
			return `export const ${marker}_${fileIndex}_${lineNumber} = compute(${fileIndex}, ${lineNumber}); // ${marker}`;
		case "css":
			return `.${marker}-${fileIndex}-${lineNumber} { padding: var(--space-${lineNumber % 8}); }`;
		case "json":
			return `  "${marker}_${fileIndex}_${lineNumber}": ${fileIndex * 1000 + lineNumber},`;
		default:
			return `- item ${marker} ${fileIndex}.${lineNumber} documents the ${marker} behaviour of module ${fileIndex}.`;
	}
}

function fakeObjectId(seed: string): string {
	let hash = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0").repeat(5).slice(0, 40);
}

function generateFile(fileIndex: number): FixtureFile {
	const extension = EXTENSIONS[fileIndex % EXTENSIONS.length];
	const name = `src/module-${String(fileIndex).padStart(2, "0")}/impl-${fileIndex}.${extension}`;

	const oldLines: string[] = [];
	for (let line = 1; line <= OLD_FILE_LENGTH; line++) {
		oldLines.push(contentLine(extension, fileIndex, line, "old"));
	}

	const newLines: string[] = [];
	const edits: FixtureEdit[] = [];
	let oldCursor = 0;
	let lineDelta = 0;
	for (const oldStart of EDIT_OLD_POSITIONS) {
		while (oldCursor < oldStart - 1) {
			newLines.push(oldLines[oldCursor]);
			oldCursor++;
		}
		const newStart = oldStart + lineDelta;
		for (let added = 0; added < ADDED_PER_EDIT; added++) {
			newLines.push(contentLine(extension, fileIndex, newStart + added, "new"));
		}
		oldCursor += DELETED_PER_EDIT;
		lineDelta += ADDED_PER_EDIT - DELETED_PER_EDIT;
		edits.push({
			oldStart,
			newStart,
			deletedCount: DELETED_PER_EDIT,
			addedCount: ADDED_PER_EDIT,
		});
	}
	while (oldCursor < oldLines.length) {
		newLines.push(oldLines[oldCursor]);
		oldCursor++;
	}

	return {
		name,
		oldLines,
		newLines,
		edits,
		patch: buildPatch(name, oldLines, newLines, edits),
	};
}

function buildPatch(
	name: string,
	oldLines: string[],
	newLines: string[],
	edits: FixtureEdit[],
): string {
	const oldOid = fakeObjectId(`${name}:old`);
	const newOid = fakeObjectId(`${name}:new`);
	const parts: string[] = [
		`diff --git a/${name} b/${name}`,
		`index ${oldOid.slice(0, 12)}..${newOid.slice(0, 12)} 100644`,
		`--- a/${name}`,
		`+++ b/${name}`,
	];
	for (const edit of edits) {
		const hunkOldStart = edit.oldStart - CONTEXT_LINES;
		const hunkNewStart = edit.newStart - CONTEXT_LINES;
		const hunkOldCount = CONTEXT_LINES + edit.deletedCount + CONTEXT_LINES;
		const hunkNewCount = CONTEXT_LINES + edit.addedCount + CONTEXT_LINES;
		parts.push(
			`@@ -${hunkOldStart},${hunkOldCount} +${hunkNewStart},${hunkNewCount} @@`,
		);
		for (let i = 0; i < CONTEXT_LINES; i++) {
			parts.push(` ${oldLines[hunkOldStart - 1 + i]}`);
		}
		for (let i = 0; i < edit.deletedCount; i++) {
			parts.push(`-${oldLines[edit.oldStart - 1 + i]}`);
		}
		for (let i = 0; i < edit.addedCount; i++) {
			parts.push(`+${newLines[edit.newStart - 1 + i]}`);
		}
		for (let i = 0; i < CONTEXT_LINES; i++) {
			parts.push(` ${oldLines[edit.oldStart + edit.deletedCount - 1 + i]}`);
		}
	}
	return parts.join("\n");
}

export const fixtureFiles: FixtureFile[] = Array.from(
	{ length: FILE_COUNT },
	(_, fileIndex) => generateFile(fileIndex),
);

export const fixturePatch = `${fixtureFiles.map((file) => file.patch).join("\n")}\n`;

export const fixtureStats = {
	fileCount: fixtureFiles.length,
	totalPatchLines: fixturePatch.split("\n").length - 1,
};

const filesByName = new Map(fixtureFiles.map((file) => [file.name, file]));

export function lookupFixtureFile(name: string): FixtureFile | undefined {
	return filesByName.get(name);
}
