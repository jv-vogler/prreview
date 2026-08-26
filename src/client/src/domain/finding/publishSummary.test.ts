import type { ReviewFindingDto } from "@dto/ReviewDto";
import { describe, expect, it } from "vitest";
import { summarizePublish } from "./publishSummary";

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

describe("summarizePublish", () => {
	it("counts an exact, review-lane comment as publishable", () => {
		const summary = summarizePublish([finding({})]);
		expect(summary.publishable).toEqual([finding({})]);
		expect(summary.excluded).toEqual([]);
	});

	it("counts a clamped, review-lane comment as publishable", () => {
		const clamped = finding({
			placement: {
				kind: "clamped",
				fileId: "file-1",
				side: "old",
				line: 5,
				requestedStartLine: 90,
				requestedEndLine: 90,
			},
		});
		expect(summarizePublish([clamped]).publishable).toEqual([clamped]);
	});

	it("excludes a pre-existing-lane comment, reporting why", () => {
		const preExisting = finding({ id: "finding-1", lane: "pre-existing" });
		const summary = summarizePublish([preExisting]);
		expect(summary.publishable).toEqual([]);
		expect(summary.excluded).toEqual([
			{ finding: preExisting, reason: "pre-existing" },
		]);
	});

	it("excludes an unplaceable comment, reporting why", () => {
		const unplaceable = finding({
			id: "finding-2",
			placement: { kind: "unplaceable" },
		});
		const summary = summarizePublish([unplaceable]);
		expect(summary.publishable).toEqual([]);
		expect(summary.excluded).toEqual([
			{ finding: unplaceable, reason: "unplaceable" },
		]);
	});
});

describe("summarizePublish with questions", () => {
	it("counts a question as publishable, exactly like any other comment", () => {
		const question = finding({
			id: "finding-3",
			kind: "question",
			tier: undefined,
		});
		const summary = summarizePublish([question]);
		expect(summary.publishable).toEqual([question]);
		expect(summary.excluded).toEqual([]);
	});
});
