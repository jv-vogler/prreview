import { describe, expect, it } from "vitest";
import { loadDiffFixture } from "../../../test/helpers/loadDiffFixture";
import { fileIdFor, hunkIdFor } from "./ids";
import { type GitDiffParserFile, parseDiff } from "./parseDiff";

const FILE_ID = /^f_[0-9a-f]{12}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

describe("parseDiff over raw git diff fixtures", () => {
	describe("modify.patch", () => {
		const [file] = parseDiff(loadDiffFixture("modify.patch"));

		it("maps the file identity and status", () => {
			expect(file.path).toBe("app.js");
			expect(file.oldPath).toBeUndefined();
			expect(file.status).toBe("modified");
			expect(file.id).toMatch(FILE_ID);
		});

		it("counts additions and deletions from the lines", () => {
			expect(file.additions).toBe(3);
			expect(file.deletions).toBe(2);
		});

		it("keeps the hunk header verbatim and recomputes spans", () => {
			expect(file.hunks).toHaveLength(1);
			const hunk = file.hunks[0];
			expect(hunk.header).toBe("@@ -1,7 +1,8 @@");
			expect(hunk.oldStart).toBe(1);
			expect(hunk.oldLines).toBe(7);
			expect(hunk.newStart).toBe(1);
			expect(hunk.newLines).toBe(8);
			expect(hunk.id).toMatch(SHA256_HEX);
		});

		it("strips prefix characters and numbers both sides", () => {
			const lines = file.hunks[0].lines;
			expect(lines[0]).toEqual({
				type: "context",
				content: "function greet(name) {",
				oldLine: 1,
				newLine: 1,
			});
			expect(lines[1]).toEqual({
				type: "del",
				content: '  const greeting = "hello";',
				oldLine: 2,
			});
			expect(lines[2]).toEqual({
				type: "add",
				content: '  const greeting = "hi there";',
				newLine: 2,
			});
		});

		it("references both blobs by oid", () => {
			expect(file.oldBlob).toEqual({ kind: "odb", oid: "4ce0e52" });
			expect(file.newBlob).toEqual({ kind: "odb", oid: "e8f488d" });
			expect(file.isBinary).toBe(false);
			expect(file.isGenerated).toBe(false);
		});
	});

	describe("add.patch", () => {
		const [file] = parseDiff(loadDiffFixture("add.patch"));

		it("normalizes /dev/null away and has no old side", () => {
			expect(file.path).toBe("notes.txt");
			expect(file.oldPath).toBeUndefined();
			expect(file.status).toBe("added");
			expect(file.oldBlob).toBeNull();
			expect(file.newBlob).toEqual({ kind: "odb", oid: "9351c38" });
		});

		it("recomputes the empty old span that gitdiff-parser reports as 1", () => {
			const hunk = file.hunks[0];
			expect(hunk.oldStart).toBe(0);
			expect(hunk.oldLines).toBe(0);
			expect(hunk.newLines).toBe(3);
		});

		it("numbers added lines on the new side only", () => {
			expect(file.additions).toBe(3);
			expect(file.deletions).toBe(0);
			for (const [index, line] of file.hunks[0].lines.entries()) {
				expect(line.type).toBe("add");
				expect(line.newLine).toBe(index + 1);
				expect(line.oldLine).toBeUndefined();
			}
		});
	});

	describe("delete.patch", () => {
		const [file] = parseDiff(loadDiffFixture("delete.patch"));

		it("takes its path from the old side", () => {
			expect(file.path).toBe("doomed.txt");
			expect(file.status).toBe("deleted");
			expect(file.oldBlob).toEqual({ kind: "odb", oid: "20aeba2" });
			expect(file.newBlob).toBeNull();
		});

		it("recomputes the empty new span", () => {
			const hunk = file.hunks[0];
			expect(hunk.newStart).toBe(0);
			expect(hunk.newLines).toBe(0);
			expect(hunk.oldLines).toBe(3);
			expect(file.deletions).toBe(3);
			expect(file.additions).toBe(0);
		});
	});

	describe("rename-with-edits.patch", () => {
		const [file] = parseDiff(loadDiffFixture("rename-with-edits.patch"));

		it("recovers renamed status although gitdiff-parser says modify", () => {
			expect(file.status).toBe("renamed");
			expect(file.path).toBe("util.js");
			expect(file.oldPath).toBe("lib.js");
		});

		it("hashes both paths into the file id", () => {
			expect(file.id).toMatch(FILE_ID);
			expect(file.id).not.toBe(fileIdFor({ path: "util.js" }));
			expect(file.id).toBe(fileIdFor({ path: "util.js", oldPath: "lib.js" }));
		});

		it("preserves the function context in the hunk header", () => {
			expect(file.hunks[0].header).toBe(
				"@@ -3,5 +3,5 @@ export function add(a, b) {",
			);
		});
	});

	describe("binary.patch", () => {
		const [file] = parseDiff(loadDiffFixture("binary.patch"));

		it("detects binary although gitdiff-parser drops the marker", () => {
			expect(file.isBinary).toBe(true);
			expect(file.status).toBe("modified");
			expect(file.hunks).toEqual([]);
			expect(file.additions).toBe(0);
			expect(file.deletions).toBe(0);
		});

		it("still references both blobs", () => {
			expect(file.oldBlob).toEqual({ kind: "odb", oid: "e321967" });
			expect(file.newBlob).toEqual({ kind: "odb", oid: "15a419c" });
		});
	});

	describe("mode-change.patch", () => {
		const [file] = parseDiff(loadDiffFixture("mode-change.patch"));

		it("is a modified file with no hunks and no binary flag", () => {
			expect(file.path).toBe("run.sh");
			expect(file.status).toBe("modified");
			expect(file.hunks).toEqual([]);
			expect(file.isBinary).toBe(false);
		});

		it("has no blob refs because a mode-only diff carries no index line", () => {
			expect(file.oldBlob).toBeNull();
			expect(file.newBlob).toBeNull();
		});
	});

	describe("no-eol.patch", () => {
		const [newSideMissing, oldSideMissing] = parseDiff(
			loadDiffFixture("no-eol.patch"),
		);

		it("marks the last new-side line when the new file lost its newline", () => {
			const lines = newSideMissing.hunks[0].lines;
			const added = lines.find((line) => line.type === "add");
			const deleted = lines.find((line) => line.type === "del");
			expect(added?.noEol).toBe(true);
			expect(deleted?.noEol).toBeUndefined();
		});

		it("marks the last old-side line when the old file had no newline", () => {
			const lines = oldSideMissing.hunks[0].lines;
			const deleted = lines.find((line) => line.type === "del");
			const added = lines.find((line) => line.type === "add");
			expect(deleted?.noEol).toBe(true);
			expect(added?.noEol).toBeUndefined();
		});
	});

	describe("duplicate-hunks.patch", () => {
		const [file] = parseDiff(loadDiffFixture("duplicate-hunks.patch"));

		it("gives identical hunk bodies dupIndex-suffixed ids", () => {
			expect(file.hunks).toHaveLength(2);
			const [first, second] = file.hunks;
			expect(hunkIdFor(first.lines)).toBe(hunkIdFor(second.lines));
			expect(first.id).toMatch(SHA256_HEX);
			expect(second.id).toBe(`${first.id}-1`);
		});

		it("keeps each hunk's own position", () => {
			const [first, second] = file.hunks;
			expect(first.newStart).toBe(2);
			expect(second.newStart).toBe(10);
		});
	});
});

describe("parseDiff over constructed parser output", () => {
	it("keeps delete-A and rename-B→A apart (the fileId collision case)", () => {
		// A two-tree git diff can never contain both entries (the new tree
		// either has A or it does not), but concatenated or served diffs can;
		// the id scheme must hold regardless.
		const deletedA: GitDiffParserFile = {
			type: "delete",
			oldPath: "a.txt",
			newPath: "/dev/null",
			oldRevision: "20aeba2",
			newRevision: "0000000",
			oldEndingNewLine: true,
			newEndingNewLine: true,
			hunks: [
				{
					content: "@@ -1,1 +0,0 @@",
					oldStart: 1,
					oldLines: 1,
					newStart: 0,
					newLines: 1,
					changes: [
						{ type: "delete", content: "the original a", lineNumber: 1 },
					],
				},
			],
		};
		const renamedBtoA: GitDiffParserFile = {
			type: "rename",
			oldPath: "b.txt",
			newPath: "a.txt",
			similarity: 100,
			oldEndingNewLine: true,
			newEndingNewLine: true,
			hunks: [],
		};

		const [deleted, renamed] = parseDiff([deletedA, renamedBtoA]);
		expect(deleted.path).toBe("a.txt");
		expect(renamed.path).toBe("a.txt");
		expect(renamed.oldPath).toBe("b.txt");
		expect(renamed.status).toBe("renamed");
		expect(deleted.id).not.toBe(renamed.id);
	});

	it("does not mistake an empty-file add for a binary change", () => {
		const emptyGitkeep: GitDiffParserFile = {
			type: "add",
			oldPath: "/dev/null",
			newPath: "assets/.gitkeep",
			oldRevision: "0000000",
			newRevision: "e69de29",
			oldEndingNewLine: true,
			newEndingNewLine: true,
			hunks: [],
		};
		const [file] = parseDiff([emptyGitkeep]);
		expect(file.isBinary).toBe(false);
		expect(file.status).toBe("added");
	});

	it("flags a binary add: no hunks but a real new-side blob", () => {
		const binaryAdd: GitDiffParserFile = {
			type: "add",
			oldPath: "/dev/null",
			newPath: "logo.png",
			oldRevision: "0000000",
			newRevision: "15a419c",
			oldEndingNewLine: true,
			newEndingNewLine: true,
			hunks: [],
		};
		const [file] = parseDiff([binaryAdd]);
		expect(file.isBinary).toBe(true);
		expect(file.oldBlob).toBeNull();
		expect(file.newBlob).toEqual({ kind: "odb", oid: "15a419c" });
	});

	it("marks generated files from the path heuristics", () => {
		const lockfile: GitDiffParserFile = {
			type: "modify",
			oldPath: "package-lock.json",
			newPath: "package-lock.json",
			oldRevision: "aaa1111",
			newRevision: "bbb2222",
			oldEndingNewLine: true,
			newEndingNewLine: true,
			hunks: [
				{
					content: "@@ -1,1 +1,1 @@",
					oldStart: 1,
					oldLines: 1,
					newStart: 1,
					newLines: 1,
					changes: [
						{ type: "delete", content: '"version": "1.0.0",', lineNumber: 1 },
						{ type: "insert", content: '"version": "1.0.1",', lineNumber: 1 },
					],
				},
			],
		};
		const [file] = parseDiff([lockfile]);
		expect(file.isGenerated).toBe(true);
	});

	it("reports a pure copy as copied", () => {
		const pureCopy: GitDiffParserFile = {
			type: "copy",
			oldPath: "template.txt",
			newPath: "copy-of-template.txt",
			similarity: 100,
			oldEndingNewLine: true,
			newEndingNewLine: true,
			hunks: [],
		};
		const [file] = parseDiff([pureCopy]);
		expect(file.status).toBe("copied");
		expect(file.oldPath).toBe("template.txt");
	});
});
