import { describe, expect, it } from "vitest";
import { captureSnapshot } from "./captureSnapshot";

const FILE_LINES = [
	"import { readFile } from 'node:fs';",
	"",
	"export function loadConfig(path) {",
	"  const raw = readFile(path);",
	"  return JSON.parse(raw);",
	"}",
	"",
	"export function saveConfig(path, data) {",
	"  const text = JSON.stringify(data);",
	"}",
];

describe("captureSnapshot", () => {
	it("captures normalized target lines and up to 3 context lines each side", () => {
		const snapshot = captureSnapshot(FILE_LINES, 4, 5, "oid-1");
		expect(snapshot.blobOid).toBe("oid-1");
		expect(snapshot.targetLines).toEqual([
			"const raw = readFile(path);",
			"return JSON.parse(raw);",
		]);
		expect(snapshot.contextBefore).toEqual([
			"import { readFile } from 'node:fs';",
			"",
			"export function loadConfig(path) {",
		]);
		expect(snapshot.contextAfter).toEqual([
			"}",
			"",
			"export function saveConfig(path, data) {",
		]);
	});

	it("truncates context at the file edges", () => {
		const snapshot = captureSnapshot(FILE_LINES, 1, 2, "oid-1");
		expect(snapshot.contextBefore).toEqual([]);
		const tail = captureSnapshot(FILE_LINES, 9, 10, "oid-1");
		expect(tail.contextAfter).toEqual([]);
	});

	it("is deterministic: same input yields the same lineHash", () => {
		const first = captureSnapshot(FILE_LINES, 4, 5, "oid-1");
		const second = captureSnapshot([...FILE_LINES], 4, 5, "oid-1");
		expect(second).toEqual(first);
		expect(second.lineHash).toBe(first.lineHash);
	});

	it("hashes normalized content, so indentation does not change the hash", () => {
		const reindented = FILE_LINES.map((line) => line.replace(/^ {2}/, "\t"));
		expect(captureSnapshot(reindented, 4, 5, "oid-1").lineHash).toBe(
			captureSnapshot(FILE_LINES, 4, 5, "oid-1").lineHash,
		);
	});

	it("differentiates hashes by content", () => {
		expect(captureSnapshot(FILE_LINES, 4, 5, "oid-1").lineHash).not.toBe(
			captureSnapshot(FILE_LINES, 4, 4, "oid-1").lineHash,
		);
	});

	it("captures an empty file-level snapshot for the 0/0 range", () => {
		const snapshot = captureSnapshot(FILE_LINES, 0, 0, "oid-1");
		expect(snapshot.targetLines).toEqual([]);
		expect(snapshot.contextBefore).toEqual([]);
		expect(snapshot.contextAfter).toEqual([]);
		expect(snapshot.lineHash).toBe(captureSnapshot([], 0, 0, "oid-1").lineHash);
	});
});
