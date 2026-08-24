import type { ReviewCommentDto } from "@dto/ReviewDto";
import { describe, expect, it } from "vitest";
import { groupPlacedComments, placedComments } from "./placedComments";

function comment(overrides: Partial<ReviewCommentDto>): ReviewCommentDto {
	return {
		id: "finding-0",
		path: "src/greeting.ts",
		startLine: 1,
		endLine: 1,
		tier: "nitpick",
		title: "x",
		body: "x",
		proof: "Inferred: x",
		verified: false,
		lane: "review",
		placement: { kind: "unplaceable" },
		edited: false,
		deleted: false,
		...overrides,
	};
}

describe("placedComments", () => {
	it("drops unplaceable comments", () => {
		const comments = [comment({ placement: { kind: "unplaceable" } })];
		expect(placedComments(comments)).toEqual([]);
	});

	it("keeps exact and clamped placements", () => {
		const comments = [
			comment({
				id: "finding-0",
				placement: { kind: "exact", fileId: "file-1", side: "new", line: 3 },
			}),
			comment({
				id: "finding-1",
				placement: {
					kind: "clamped",
					fileId: "file-1",
					side: "old",
					line: 5,
					requestedStartLine: 90,
					requestedEndLine: 90,
				},
			}),
		];
		expect(placedComments(comments)).toEqual([
			{ fileId: "file-1", side: "new", line: 3, commentId: "finding-0" },
			{ fileId: "file-1", side: "old", line: 5, commentId: "finding-1" },
		]);
	});
});

describe("groupPlacedComments", () => {
	it("merges comments anchored to the same file, side and line", () => {
		const grouped = groupPlacedComments([
			{ fileId: "file-1", side: "new", line: 3, commentId: "finding-0" },
			{ fileId: "file-1", side: "new", line: 3, commentId: "finding-1" },
			{ fileId: "file-1", side: "old", line: 3, commentId: "finding-2" },
		]);
		expect(grouped).toEqual([
			{
				fileId: "file-1",
				side: "new",
				line: 3,
				commentIds: ["finding-0", "finding-1"],
			},
			{ fileId: "file-1", side: "old", line: 3, commentIds: ["finding-2"] },
		]);
	});
});
