import { describe, expect, it } from "vitest";
import type { StoredReview } from "../../application/ports/SessionStore";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { reviewPassDtoSchema } from "./dto/ReviewDto";
import { toReviewPassDto } from "./toReviewPassDto";

const STORED: StoredReview = {
	changesetId: "worktree",
	createdAt: "2026-08-22T00:00:00.000Z",
	headSha: null,
	pass: {
		overview: "x",
		verdict: "x",
		ticket: null,
		explanations: [
			{
				path: "src/a.ts",
				startLine: 1,
				endLine: 1,
				says: ["What the change does.", "Why it does it."],
				topic: "one intent",
			},
			{
				path: "not/in/diff.ts",
				startLine: 9,
				endLine: 9,
				says: ["Unplaceable, still on the wire."],
			},
		],
		findings: [],
	},
	residue: [],
	commentEdits: {},
	published: null,
};

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

describe("toReviewPassDto", () => {
	it("maps explanations with placement and ids, and the result fits the DTO schema", () => {
		const dto = toReviewPassDto(STORED, [FILE]);
		expect(dto.explanations).toEqual([
			{
				id: "explanation-0",
				path: "src/a.ts",
				startLine: 1,
				endLine: 1,
				says: ["What the change does.", "Why it does it."],
				topic: "one intent",
				placement: { kind: "exact", fileId: "file-1", side: "new", line: 1 },
			},
			{
				id: "explanation-1",
				path: "not/in/diff.ts",
				startLine: 9,
				endLine: 9,
				says: ["Unplaceable, still on the wire."],
				placement: { kind: "unplaceable" },
			},
		]);
		expect(reviewPassDtoSchema.safeParse(dto).success).toBe(true);
	});
});
