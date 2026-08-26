import type { ReviewFindingDto } from "@dto/ReviewDto";
import { describe, expect, it } from "vitest";
import { countByTier, countQuestions } from "./countByTier";

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
		placement: { kind: "exact", fileId: "file-1", side: "new", line: 1 },
		edited: false,
		deleted: false,
		published: false,
		carried: false,
		...overrides,
	};
}

const QUESTION = finding({
	id: "finding-1",
	kind: "question",
	tier: undefined,
});

describe("countByTier", () => {
	it("counts each tier that is present", () => {
		const counts = countByTier([finding({}), finding({ tier: "blocker" })]);
		expect(counts).toEqual({
			blocker: 1,
			"should-fix": 0,
			suggestion: 0,
			nitpick: 1,
		});
	});

	it("leaves a question out of every tier, since it has none", () => {
		expect(countByTier([QUESTION])).toEqual({
			blocker: 0,
			"should-fix": 0,
			suggestion: 0,
			nitpick: 0,
		});
	});
});

describe("countQuestions", () => {
	it("counts the questions apart from the ladder", () => {
		expect(countQuestions([finding({}), QUESTION])).toBe(1);
	});
});
