import { describe, expect, it } from "vitest";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { buildReviewPrompt, renderNumberedDiff } from "./reviewPrompt";

const FILE: FileDiff = {
	id: "f1",
	path: "src/greeting.ts",
	status: "modified",
	additions: 1,
	deletions: 1,
	isBinary: false,
	isGenerated: false,
	oldBlob: null,
	newBlob: null,
	hunks: [
		{
			id: "h1",
			header: "",
			oldStart: 1,
			oldLines: 2,
			newStart: 1,
			newLines: 2,
			lines: [
				{
					type: "context",
					content: "function greet() {",
					oldLine: 1,
					newLine: 1,
				},
				{ type: "del", content: '  return "hi";', oldLine: 2 },
				{ type: "add", content: '  return "hello";', newLine: 2 },
			],
		},
	],
};

describe("renderNumberedDiff", () => {
	it("says so when there are no changed files", () => {
		expect(renderNumberedDiff([])).toContain("no files changed");
	});

	it("numbers each line by its new-side (or old-side, for deletions) line number", () => {
		const rendered = renderNumberedDiff([FILE]);
		expect(rendered).toContain("src/greeting.ts");
		expect(rendered).toContain('2 +   return "hello";');
		expect(rendered).toContain('2 -   return "hi";');
	});

	it("marks a binary file without attempting a text diff", () => {
		const binary: FileDiff = { ...FILE, isBinary: true, hunks: [] };
		expect(renderNumberedDiff([binary])).toContain("binary file");
	});
});

describe("buildReviewPrompt", () => {
	const prompt = buildReviewPrompt({
		announce: "reviewing PR #42 (base main, head feature-x)",
		files: [FILE],
	});

	it("carries the resolved target forward", () => {
		expect(prompt).toContain("reviewing PR #42");
	});

	it("preserves the pasteable budget and mandatory cut pass", () => {
		expect(prompt).toContain("500 characters");
		expect(prompt).toContain("cut half of it");
	});

	it("preserves the four severity tiers mapped to GitHub alert blocks", () => {
		for (const tier of ["blocker", "should-fix", "suggestion", "nitpick"]) {
			expect(prompt).toContain(tier);
		}
		for (const alert of ["[!CAUTION]", "[!WARNING]", "[!TIP]", "[!NOTE]"]) {
			expect(prompt).toContain(alert);
		}
	});

	it("instructs structured output rather than a scratchfile", () => {
		expect(prompt).not.toContain("review-notes");
		expect(prompt).not.toContain("scratchfile");
	});

	it("carries the numbered diff", () => {
		expect(prompt).toContain(renderNumberedDiff([FILE]));
	});
});
