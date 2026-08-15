import { describe, expect, it } from "vitest";
import type { DiffLine } from "./DiffLine";
import { assignHunkIds, fileIdFor, hunkIdFor } from "./ids";

const SHA256_HEX = /^[0-9a-f]{64}$/;

function hunkBody(atLine: number): DiffLine[] {
	return [
		{ type: "context", content: "before", oldLine: atLine, newLine: atLine },
		{ type: "del", content: "removed", oldLine: atLine + 1 },
		{ type: "add", content: "inserted", newLine: atLine + 1 },
		{
			type: "context",
			content: "after",
			oldLine: atLine + 2,
			newLine: atLine + 2,
		},
	];
}

describe("hunkIdFor", () => {
	it("is a full sha256 hex digest", () => {
		expect(hunkIdFor(hunkBody(1))).toMatch(SHA256_HEX);
	});

	it("is stable across position shifts: line numbers do not participate", () => {
		expect(hunkIdFor(hunkBody(3))).toBe(hunkIdFor(hunkBody(700)));
	});

	it("changes when line content changes", () => {
		const shifted = hunkBody(1);
		const edited = hunkBody(1).map((line) =>
			line.type === "add" ? { ...line, content: "inserted!" } : line,
		);
		expect(hunkIdFor(edited)).not.toBe(hunkIdFor(shifted));
	});

	it("changes when only a line's type changes", () => {
		const asContext: DiffLine[] = [
			{ type: "context", content: "same", oldLine: 1, newLine: 1 },
		];
		const asAdd: DiffLine[] = [{ type: "add", content: "same", newLine: 1 }];
		expect(hunkIdFor(asContext)).not.toBe(hunkIdFor(asAdd));
	});

	it("ignores noEol: the marker is metadata, not content", () => {
		const plain: DiffLine[] = [{ type: "add", content: "tail", newLine: 9 }];
		const marked: DiffLine[] = [
			{ type: "add", content: "tail", newLine: 9, noEol: true },
		];
		expect(hunkIdFor(marked)).toBe(hunkIdFor(plain));
	});
});

describe("assignHunkIds", () => {
	it("gives unique bodies their bare content hash", () => {
		const bodies = [
			hunkBody(1),
			hunkBody(50).map((line) => ({ ...line, content: `${line.content}-b` })),
		];
		const ids = assignHunkIds(bodies);
		expect(ids[0]).toBe(hunkIdFor(bodies[0]));
		expect(ids[1]).toBe(hunkIdFor(bodies[1]));
	});

	it("suffixes a dupIndex onto identical bodies within one file", () => {
		const ids = assignHunkIds([hunkBody(2), hunkBody(90), hunkBody(400)]);
		const bareId = hunkIdFor(hunkBody(2));
		expect(ids).toEqual([bareId, `${bareId}-1`, `${bareId}-2`]);
	});

	it("keeps every id distinct even with duplicates present", () => {
		const ids = assignHunkIds([hunkBody(1), hunkBody(9), hunkBody(1)]);
		expect(new Set(ids).size).toBe(3);
	});
});

describe("fileIdFor", () => {
	it('is "f_" plus 12 hex characters', () => {
		expect(fileIdFor({ path: "src/app.ts" })).toMatch(/^f_[0-9a-f]{12}$/);
	});

	it("is deterministic", () => {
		expect(fileIdFor({ path: "a.txt", oldPath: "b.txt" })).toBe(
			fileIdFor({ path: "a.txt", oldPath: "b.txt" }),
		);
	});

	it("does not collide when one changeset deletes A and renames B → A", () => {
		const deletedA = fileIdFor({ path: "a.txt" });
		const renamedBtoA = fileIdFor({ path: "a.txt", oldPath: "b.txt" });
		expect(deletedA).not.toBe(renamedBtoA);
	});

	it("treats a missing old side as oldPath = path", () => {
		expect(fileIdFor({ path: "a.txt" })).toBe(
			fileIdFor({ path: "a.txt", oldPath: "a.txt" }),
		);
	});
});
