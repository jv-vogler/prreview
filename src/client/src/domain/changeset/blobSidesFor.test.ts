import type { ChangesetRefDto, FileDiffDto } from "@dto/ChangesetDto";
import { describe, expect, it } from "vitest";
import { blobSidesFor } from "./blobSidesFor";

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);

function refWithHead(headSha: string | null): ChangesetRefDto {
	return {
		source: { kind: "worktree" },
		baseSha: BASE_SHA,
		headSha,
		resolvedAt: "2026-08-15T00:00:00Z",
	};
}

function fileWith(overrides: Partial<FileDiffDto>): FileDiffDto {
	return {
		id: "f_abc",
		path: "src/app.ts",
		status: "modified",
		additions: 1,
		deletions: 1,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: null,
		hunks: [],
		...overrides,
	};
}

describe("blobSidesFor", () => {
	it("reads both sides at the resolved commits for a modified file", () => {
		const sides = blobSidesFor(fileWith({}), refWithHead(HEAD_SHA));
		expect(sides.oldSide).toEqual({ ref: BASE_SHA, path: "src/app.ts" });
		expect(sides.newSide).toEqual({ ref: HEAD_SHA, path: "src/app.ts" });
	});

	it("reads the new side from the working tree when there is no head commit", () => {
		const sides = blobSidesFor(fileWith({}), refWithHead(null));
		expect(sides.newSide).toEqual({ ref: "WORKING", path: "src/app.ts" });
	});

	it("uses the pre-rename path for the old side", () => {
		const sides = blobSidesFor(
			fileWith({ status: "renamed", oldPath: "src/old.ts" }),
			refWithHead(HEAD_SHA),
		);
		expect(sides.oldSide).toEqual({ ref: BASE_SHA, path: "src/old.ts" });
		expect(sides.newSide).toEqual({ ref: HEAD_SHA, path: "src/app.ts" });
	});

	it("has no old side for added files and no new side for deleted files", () => {
		expect(
			blobSidesFor(fileWith({ status: "added" }), refWithHead(HEAD_SHA))
				.oldSide,
		).toBeNull();
		expect(
			blobSidesFor(fileWith({ status: "deleted" }), refWithHead(HEAD_SHA))
				.newSide,
		).toBeNull();
	});
});
