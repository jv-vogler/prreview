import type { DiffLine } from "./DiffLine";
import type { FileDiff } from "./FileDiff";
import type { Hunk } from "./Hunk";
import { assignHunkIds, fileIdFor } from "./ids";
import { isGenerated } from "./isGenerated";

export interface GitDiffParserChange {
	type: "normal" | "insert" | "delete";
	content: string;
	lineNumber?: number;
	oldLineNumber?: number;
	newLineNumber?: number;
}

export interface GitDiffParserHunk {
	content: string;
	oldStart: number;
	newStart: number;
	oldLines: number;
	newLines: number;
	changes: GitDiffParserChange[];
}

export interface GitDiffParserFile {
	type: "add" | "delete" | "modify" | "rename" | "copy";
	oldPath: string;
	newPath: string;
	oldRevision?: string;
	newRevision?: string;
	oldMode?: string;
	newMode?: string;
	similarity?: number;
	isBinary?: boolean;
	oldEndingNewLine?: boolean;
	newEndingNewLine?: boolean;
	hunks: GitDiffParserHunk[];
}

const DEV_NULL = "/dev/null";

const EMPTY_BLOB_OIDS = [
	"e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",

	"473a0f4c3be8a93681a267e3b1e9a7dcda1185436fe141f7749120a303721813",
];

export function parseDiff(files: readonly GitDiffParserFile[]): FileDiff[] {
	return files.map(toFileDiff);
}

function toFileDiff(file: GitDiffParserFile): FileDiff {
	const status = statusOf(file);
	const path = status === "deleted" ? file.oldPath : file.newPath;
	const hasDistinctOldSide =
		(status === "renamed" || status === "copied") && file.oldPath !== DEV_NULL;
	const oldPath = hasDistinctOldSide ? file.oldPath : undefined;

	const lineRuns = file.hunks.map(toDiffLines);
	markMissingFinalNewlines(lineRuns, file);
	const hunkIds = assignHunkIds(lineRuns);
	const hunks = file.hunks.map((hunk, index): Hunk => {
		const lines = lineRuns[index];
		return {
			id: hunkIds[index],
			header: hunk.content,
			oldStart: hunk.oldStart,
			oldLines: countLines(lines, "old"),
			newStart: hunk.newStart,
			newLines: countLines(lines, "new"),
			lines,
		};
	});

	const allLines = lineRuns.flat();
	return {
		id: fileIdFor({ path, oldPath }),
		path,
		...(oldPath === undefined ? {} : { oldPath }),
		status,
		additions: allLines.filter((line) => line.type === "add").length,
		deletions: allLines.filter((line) => line.type === "del").length,
		isBinary: isBinaryFile(file),
		isGenerated: isGenerated(path),
		oldBlob: status === "added" ? null : blobRefOf(file.oldRevision),
		newBlob: status === "deleted" ? null : blobRefOf(file.newRevision),
		hunks,
	};
}

function statusOf(file: GitDiffParserFile): FileDiff["status"] {
	if (file.type === "add") {
		return "added";
	}
	if (file.type === "delete") {
		return "deleted";
	}
	if (file.type === "copy") {
		return "copied";
	}
	if (file.oldPath !== file.newPath) {
		return "renamed";
	}
	return "modified";
}

function toDiffLines(hunk: GitDiffParserHunk): DiffLine[] {
	return hunk.changes.map((change): DiffLine => {
		if (change.type === "insert") {
			return {
				type: "add",
				content: change.content,
				newLine: change.lineNumber,
			};
		}
		if (change.type === "delete") {
			return {
				type: "del",
				content: change.content,
				oldLine: change.lineNumber,
			};
		}
		return {
			type: "context",
			content: change.content,
			oldLine: change.oldLineNumber,
			newLine: change.newLineNumber,
		};
	});
}

function countLines(lines: readonly DiffLine[], side: "old" | "new"): number {
	if (side === "old") {
		return lines.filter((line) => line.oldLine !== undefined).length;
	}
	return lines.filter((line) => line.newLine !== undefined).length;
}

function markMissingFinalNewlines(
	lineRuns: DiffLine[][],
	file: GitDiffParserFile,
): void {
	if (file.oldEndingNewLine === false) {
		markLastLineOnSide(lineRuns, "oldLine");
	}
	if (file.newEndingNewLine === false) {
		markLastLineOnSide(lineRuns, "newLine");
	}
}

function markLastLineOnSide(
	lineRuns: DiffLine[][],
	side: "oldLine" | "newLine",
): void {
	const allLines = lineRuns.flat();
	for (let index = allLines.length - 1; index >= 0; index--) {
		const line = allLines[index];
		if (line[side] !== undefined) {
			line.noEol = true;
			return;
		}
	}
}

function isBinaryFile(file: GitDiffParserFile): boolean {
	if (file.isBinary === true) {
		return true;
	}
	if (file.hunks.length > 0) {
		return false;
	}
	if (file.oldRevision === undefined || file.newRevision === undefined) {
		return false;
	}
	return isContentBlob(file.oldRevision) || isContentBlob(file.newRevision);
}

function isContentBlob(revision: string): boolean {
	if (revision.length === 0 || /^0+$/.test(revision)) {
		return false;
	}
	return !EMPTY_BLOB_OIDS.some((emptyOid) => emptyOid.startsWith(revision));
}

function blobRefOf(
	revision: string | undefined,
): { kind: "odb"; oid: string } | null {
	if (
		revision === undefined ||
		revision.length === 0 ||
		/^0+$/.test(revision)
	) {
		return null;
	}
	return { kind: "odb", oid: revision };
}
