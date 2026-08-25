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
				grounding: "inferred",
				topic: "one intent",
			},
			{
				path: "not/in/diff.ts",
				startLine: 9,
				endLine: 9,
				says: ["Unplaceable, still on the wire."],
				grounding: "inferred",
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

	it("marks exactly the comments the last publish sent", () => {
		const stored: StoredReview = {
			...STORED,
			pass: {
				...STORED.pass,
				explanations: [],
				findings: [
					{
						path: "src/a.ts",
						startLine: 1,
						endLine: 1,
						kind: "defect",
						tier: "nitpick",
						title: "sent",
						body: "b",
						proof: "Inferred: x",
						verified: false,
						lane: "review",
					},
					{
						path: "src/a.ts",
						startLine: 1,
						endLine: 1,
						kind: "defect",
						tier: "nitpick",
						title: "kept back",
						body: "b",
						proof: "Inferred: x",
						verified: false,
						lane: "review",
					},
				],
			},
			published: {
				reviewId: 1,
				htmlUrl: "https://example.com/r/1",
				publishedAt: "2026-08-23T00:00:00.000Z",
				commentIds: ["finding-0"],
			},
		};
		const dto = toReviewPassDto(stored, [FILE]);
		expect(dto.comments.map((comment) => comment.published)).toEqual([
			true,
			false,
		]);
	});

	it("marks a finding this pass carried without looking at it again", () => {
		const finding = {
			path: "src/a.ts",
			startLine: 1,
			endLine: 1,
			kind: "defect" as const,
			tier: "nitpick" as const,
			title: "t",
			body: "b",
			proof: "Inferred: x",
			verified: false,
			lane: "review" as const,
		};
		const pass = toReviewPassDto(
			{
				...STORED,
				pass: { ...STORED.pass, findings: [finding, finding] },
				findingIds: ["finding-4", "finding-9"],
				carriedFindingIds: ["finding-4"],
			},
			[FILE],
		);

		expect(
			pass.comments.map((comment) => [comment.id, comment.carried]),
		).toEqual([
			["finding-4", true],
			["finding-9", false],
		]);
	});
});
