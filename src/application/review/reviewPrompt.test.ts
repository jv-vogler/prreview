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

	it("asks for the five task calls in one message, not one per turn", () => {
		expect(prompt).toContain("**in a single message**");
	});

	it("asks for a five-item task plan the reviewer watches live", () => {
		expect(prompt).toContain("## Working plan");
		expect(prompt).toContain("TaskCreate");
		expect(prompt).toContain("TaskUpdate");
		for (const step of [
			"find the ticket",
			"read the big picture",
			"find problems",
			"verify findings",
			"write it up",
		]) {
			expect(prompt).toContain(step);
		}
	});

	it("preserves the pasteable budget and mandatory cut pass", () => {
		expect(prompt).toContain("500 characters");
		expect(prompt).toContain("cut half of it");
	});

	it("asks for the overview in short paragraphs, budgeted, as markdown", () => {
		expect(prompt).toContain("two or three short paragraphs");
		expect(prompt).toContain("700 characters");
		expect(prompt).toContain("renders as markdown");
	});

	it("asks for mid-level change explanations covering every file", () => {
		expect(prompt).toContain("## Explain the change");
		expect(prompt).toContain("Pitch each explanation mid-level");
		expect(prompt).toContain("what the diff cannot show");
		expect(prompt).toContain("Never narrate syntax");
		expect(prompt).toContain("never float so high the mechanism disappears");
		expect(prompt).toContain("Skip only purely mechanical changes");
		expect(prompt).toContain("Cover the whole change");
		expect(prompt).toContain(
			"every file in the diff gets at least one explanation",
		);
		expect(prompt).toContain("one sentence naming its role in the change");
		expect(prompt).toContain("never review feedback and never report problems");
	});

	it("worked explanation example contrasts narrating the diff with the what-then-why", () => {
		expect(prompt).toContain("conditionally concatenate the evidence field");
		expect(prompt).toContain(
			"The evidence block now ships inside the body GitHub receives.",
		);
	});

	it("asks for the topic labels to be mentioned in the overview, verbatim", () => {
		expect(prompt).toContain("Mention each `topic` label in the overview");
		expect(prompt).toContain("colored chip");
	});

	it("asks for the scope outcome as a machine-readable field", () => {
		expect(prompt).toContain("Record the outcome in `scope`");
		for (const value of [
			'"matches"',
			'"misses-pieces"',
			'"unrelated-extras"',
			'"no-ticket"',
		]) {
			expect(prompt).toContain(value);
		}
	});

	it("grounds explanations in the code, not the PR description", () => {
		expect(prompt).toContain(
			"the description is the author's claim about their own work",
		);
	});

	it("anchors explanations exactly like findings, with shared topic labels", () => {
		expect(prompt).toContain("Anchor each explanation exactly like a finding");
		expect(prompt).toContain("same short `topic` label");
	});

	it("scopes the no-hard-wrap rule to `body`, so the overview may paragraph", () => {
		expect(prompt).toContain("Never hard-wrap a `body` paragraph");
		expect(prompt).not.toContain("**Never hard-wrap prose.**");
	});

	it("bans the em-dash, and its own example obeys the ban", () => {
		expect(prompt).toContain("Never use an em-dash");
		expect(prompt).toContain("the error is swallowed. The order is lost");
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
