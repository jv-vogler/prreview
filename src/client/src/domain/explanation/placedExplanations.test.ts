import type { ExplanationDto } from "@dto/ReviewDto";
import { describe, expect, it } from "vitest";
import {
	groupPlacedExplanations,
	placedExplanations,
} from "./placedExplanations";

function explanation(overrides: Partial<ExplanationDto>): ExplanationDto {
	return {
		id: "explanation-0",
		path: "src/a.ts",
		startLine: 1,
		endLine: 1,
		says: ["What the change does."],
		placement: { kind: "exact", fileId: "file-1", side: "new", line: 1 },
		...overrides,
	};
}

describe("placedExplanations", () => {
	it("drops unplaceable explanations and keeps exact and clamped ones", () => {
		const placed = placedExplanations([
			explanation({ id: "explanation-0" }),
			explanation({
				id: "explanation-1",
				placement: { kind: "unplaceable" },
			}),
			explanation({
				id: "explanation-2",
				placement: {
					kind: "clamped",
					fileId: "file-1",
					side: "old",
					line: 4,
					requestedStartLine: 1,
					requestedEndLine: 9,
				},
			}),
		]);
		expect(placed).toEqual([
			{
				fileId: "file-1",
				side: "new",
				line: 1,
				explanationId: "explanation-0",
			},
			{
				fileId: "file-1",
				side: "old",
				line: 4,
				explanationId: "explanation-2",
			},
		]);
	});
});

describe("groupPlacedExplanations", () => {
	it("shares one slot between explanations landing on the same line", () => {
		const groups = groupPlacedExplanations(
			placedExplanations([
				explanation({ id: "explanation-0" }),
				explanation({ id: "explanation-1" }),
				explanation({
					id: "explanation-2",
					placement: { kind: "exact", fileId: "file-1", side: "new", line: 5 },
				}),
			]),
		);
		expect(groups).toEqual([
			{
				fileId: "file-1",
				side: "new",
				line: 1,
				explanationIds: ["explanation-0", "explanation-1"],
			},
			{
				fileId: "file-1",
				side: "new",
				line: 5,
				explanationIds: ["explanation-2"],
			},
		]);
	});
});
