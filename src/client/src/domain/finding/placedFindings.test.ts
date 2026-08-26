import type { ReviewFindingDto } from "@dto/ReviewDto";
import { describe, expect, it } from "vitest";
import { groupPlacedFindings, placedFindings } from "./placedFindings";

function finding(overrides: Partial<ReviewFindingDto>): ReviewFindingDto {
	return {
		id: "finding-0",
		path: "src/greeting.ts",
		startLine: 1,
		endLine: 1,
		kind: "defect",
		tier: "nitpick",
		title: "x",
		body: "x",
		proof: "Inferred: x",
		verified: false,
		lane: "review",
		placement: { kind: "unplaceable" },
		edited: false,
		deleted: false,
		published: false,
		carried: false,
		...overrides,
	};
}

describe("placedFindings", () => {
	it("drops unplaceable findings", () => {
		const findings = [finding({ placement: { kind: "unplaceable" } })];
		expect(placedFindings(findings)).toEqual([]);
	});

	it("keeps exact and clamped placements", () => {
		const findings = [
			finding({
				id: "finding-0",
				placement: { kind: "exact", fileId: "file-1", side: "new", line: 3 },
			}),
			finding({
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
		expect(placedFindings(findings)).toEqual([
			{ fileId: "file-1", side: "new", line: 3, findingId: "finding-0" },
			{ fileId: "file-1", side: "old", line: 5, findingId: "finding-1" },
		]);
	});
});

describe("groupPlacedFindings", () => {
	it("merges findings anchored to the same file, side and line", () => {
		const grouped = groupPlacedFindings([
			{ fileId: "file-1", side: "new", line: 3, findingId: "finding-0" },
			{ fileId: "file-1", side: "new", line: 3, findingId: "finding-1" },
			{ fileId: "file-1", side: "old", line: 3, findingId: "finding-2" },
		]);
		expect(grouped).toEqual([
			{
				fileId: "file-1",
				side: "new",
				line: 3,
				findingIds: ["finding-0", "finding-1"],
			},
			{ fileId: "file-1", side: "old", line: 3, findingIds: ["finding-2"] },
		]);
	});
});
