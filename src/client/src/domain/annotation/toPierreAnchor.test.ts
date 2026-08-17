import type { AnchorDto } from "@dto/AnchorDto";
import { describe, expect, it } from "vitest";
import { toPierreAnchor } from "./toPierreAnchor";

function anchor(overrides: Partial<AnchorDto> = {}): AnchorDto {
	return {
		fileId: "f1",
		path: "src/server.ts",
		side: "new",
		startLine: 10,
		endLine: 14,
		placement: "in-diff",
		...overrides,
	};
}

describe("toPierreAnchor", () => {
	it("places an in-diff note on the new side under its last line", () => {
		expect(toPierreAnchor(anchor())).toEqual({
			side: "additions",
			lineNumber: 14,
		});
	});

	it("places an in-diff note on the old side as a deletion", () => {
		expect(
			toPierreAnchor(anchor({ side: "old", startLine: 3, endLine: 3 })),
		).toEqual({ side: "deletions", lineNumber: 3 });
	});

	it("places an in-file note (outside every hunk) the same way", () => {
		expect(
			toPierreAnchor(
				anchor({ placement: "in-file", startLine: 120, endLine: 130 }),
			),
		).toEqual({ side: "additions", lineNumber: 130 });
	});

	it("places a file-level note above the first row of its side", () => {
		expect(
			toPierreAnchor(
				anchor({ placement: "file-level", startLine: 0, endLine: 0 }),
			),
		).toEqual({ side: "additions", lineNumber: 0 });
		expect(
			toPierreAnchor(
				anchor({
					placement: "file-level",
					side: "old",
					startLine: 0,
					endLine: 0,
				}),
			),
		).toEqual({ side: "deletions", lineNumber: 0 });
	});

	it("ignores line numbers a file-level anchor happens to carry", () => {
		expect(
			toPierreAnchor(
				anchor({ placement: "file-level", startLine: 40, endLine: 44 }),
			).lineNumber,
		).toBe(0);
	});
});
