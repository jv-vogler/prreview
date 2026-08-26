import type { ExplanationDto } from "@dto/ReviewDto";
import { describe, expect, it } from "vitest";
import { sortExplanationsByDiff } from "./explanationOrder";

function explanation(
	id: string,
	path: string,
	startLine: number,
): ExplanationDto {
	return {
		id,
		path,
		startLine,
		endLine: startLine,
		says: [`Behind ${id}.`],
		placement: {
			kind: "exact",
			fileId: "file-1",
			side: "new",
			line: startLine,
		},
	};
}

describe("sortExplanationsByDiff", () => {
	it("puts them in the diff's file order, then line order", () => {
		const sorted = sortExplanationsByDiff(
			[
				explanation("explanation-0", "src/b.ts", 4),
				explanation("explanation-1", "src/a.ts", 90),
				explanation("explanation-2", "src/a.ts", 12),
			],
			["src/a.ts", "src/b.ts"],
		);
		expect(sorted.map((entry) => entry.id)).toEqual([
			"explanation-2",
			"explanation-1",
			"explanation-0",
		]);
	});

	it("sorts an explanation the diff does not contain last", () => {
		const sorted = sortExplanationsByDiff(
			[
				explanation("explanation-0", "not/in/the/diff.ts", 1),
				explanation("explanation-1", "src/a.ts", 5),
			],
			["src/a.ts"],
		);
		expect(sorted.map((entry) => entry.id)).toEqual([
			"explanation-1",
			"explanation-0",
		]);
	});

	it("leaves the input alone", () => {
		const input = [
			explanation("explanation-0", "src/b.ts", 1),
			explanation("explanation-1", "src/a.ts", 1),
		];
		sortExplanationsByDiff(input, ["src/a.ts", "src/b.ts"]);
		expect(input.map((entry) => entry.id)).toEqual([
			"explanation-0",
			"explanation-1",
		]);
	});
});
