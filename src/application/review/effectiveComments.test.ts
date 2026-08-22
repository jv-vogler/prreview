import { describe, expect, it } from "vitest";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { StoredReview } from "../ports/SessionStore";
import { effectiveComments } from "./effectiveComments";

function storedReview(overrides: Partial<StoredReview> = {}): StoredReview {
	return {
		changesetId: "worktree",
		createdAt: "2026-08-22T00:00:00.000Z",
		pass: {
			overview: "x",
			verdict: "x",
			ticket: null,
			qualityPoints: [],
			findings: [
				{
					path: "src/a.ts",
					startLine: 1,
					endLine: 1,
					tier: "nitpick",
					title: "t",
					body: "original body",
					proof: "Inferred: x",
					verified: false,
					lane: "review",
				},
			],
		},
		residue: [],
		commentEdits: {},
		published: null,
		...overrides,
	};
}

const FILE: FileDiff = {
	id: "file-1",
	path: "src/a.ts",
	status: "modified",
	additions: 1,
	deletions: 0,
	isBinary: false,
	isGenerated: false,
	oldBlob: null,
	newBlob: null,
	hunks: [
		{
			id: "hunk-1",
			header: "",
			oldStart: 1,
			oldLines: 0,
			newStart: 1,
			newLines: 1,
			lines: [{ type: "add", content: "x", newLine: 1 }],
		},
	],
};

describe("effectiveComments", () => {
	it("resolves a stable id, placement and edited=false for an untouched finding", () => {
		const [comment] = effectiveComments(storedReview(), [FILE]);
		expect(comment).toMatchObject({
			id: "finding-0",
			body: "original body",
			edited: false,
			placement: { kind: "exact", fileId: "file-1", side: "new", line: 1 },
		});
	});

	it("layers an edit's body on top without touching the underlying finding", () => {
		const stored = storedReview({
			commentEdits: { "finding-0": { body: "reworded" } },
		});
		const [comment] = effectiveComments(stored, [FILE]);
		expect(comment).toMatchObject({ body: "reworded", edited: true });
	});

	it("leaves a deleted finding out entirely rather than tagging it", () => {
		const stored = storedReview({
			commentEdits: { "finding-0": { deleted: true } },
		});
		expect(effectiveComments(stored, [FILE])).toEqual([]);
	});

	it("marks a finding unplaceable when its path is not in the diff", () => {
		const [comment] = effectiveComments(storedReview(), []);
		expect(comment.placement).toEqual({ kind: "unplaceable" });
	});
});
