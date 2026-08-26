import { describe, expect, it } from "vitest";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { renderNumberedDiff } from "./numberedDiff";
import { buildReviewPrompt } from "./reviewPrompt";

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

	it("carries no previous-review section on a first pass", () => {
		expect(prompt).not.toContain("## Previous review");
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

	it("asks a topic label to carry the change, not name an area", () => {
		expect(prompt).toContain(
			"**A `topic` label says what changed, not which area it touched.**",
		);
		expect(prompt).toContain('not "Question in the UI"');
		expect(prompt).toContain(
			"A label naming only a layer, a file or a feature area is too vague",
		);
	});

	it("anchors explanations exactly like findings, with shared topic labels", () => {
		expect(prompt).toContain("Anchor each explanation exactly like a finding");
		expect(prompt).toContain("give them the same `topic` label");
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

	it("sizes the review to the change without moving the standards", () => {
		expect(prompt).toContain("## Review depth");
		expect(prompt).toContain(
			"**Calibrate the depth of the review to the change. Never calibrate the standards to the change.**",
		);
		expect(prompt).toContain(
			"Say which depth you chose in one clause of the overview",
		);
	});

	it("names each craft standard the review holds code to", () => {
		expect(prompt).toContain("## Craft");
		expect(prompt).toContain("**Names spell out meaning.**");
		expect(prompt).toContain("**Return early.**");
		expect(prompt).toContain("**Never nest ternaries**");
		expect(prompt).toContain("**Comments explain why, never what.**");
		expect(prompt).toContain("**No magic numbers.**");
		expect(prompt).toContain("**Pure by default.**");
	});

	it("refuses to excuse a craft violation by the size of the code", () => {
		expect(prompt).toContain(
			"Never excuse a violation by the size or triviality of the code it appears in.",
		);
		expect(prompt).toContain(
			"A magic number in a three-line helper is still a magic number",
		);
		expect(prompt).toContain("that is the violation talking");
	});

	it("has the standards imbued rather than cited, and not doubling as lint", () => {
		expect(prompt).toContain("**The standards are imbued, never cited.**");
		expect(prompt).toContain(
			'"Violates the no-nested-ternaries standard" is not.',
		);
		expect(prompt).toContain("These are review findings, not lint output.");
	});

	it("carries all eight problem-finding checks", () => {
		for (const check of [
			"**Should this exist?**",
			"**Is each added thing necessary, and what did this make dead?**",
			"**Do the types and names tell the truth?**",
			"**Simulate the runtime.**",
			"**Does it belong here?**",
			"**Does it match decisions already made here?**",
			"**Will we know when it breaks?**",
			"**What do the tests prove?**",
		]) {
			expect(prompt).toContain(check);
		}
	});

	it("applies the kill test before any finding is written", () => {
		expect(prompt).toContain(
			"**The kill test, before you write any finding:**",
		);
		expect(prompt).toContain(
			"could you have written this comment without knowing anything about this system?",
		);
		expect(prompt).toContain(
			"An argument from evidence is checkable, taste is not.",
		);
	});

	it("holds a nitpick to a bar without ever setting a quota", () => {
		expect(prompt).toContain(
			"one that would not survive being said aloud in a review call does not belong in the pass",
		);
		expect(prompt).toContain("That is a bar, not a quota");
	});

	it("gates a question on all five conditions and names no expected number", () => {
		expect(prompt).toContain("## Questions");
		expect(prompt).toContain("only when all five of these hold");
		expect(prompt).toContain("**The code and the codebase do not answer it.**");
		expect(prompt).toContain("**The answer would change the review.**");
		expect(prompt).toContain("**The choice is load-bearing:**");
		expect(prompt).toContain("**You looked and did not find it:**");
		expect(prompt).toContain("**It deviates from a rule or a sibling**");
		expect(prompt).toContain("There is no expected number of questions.");
	});

	it("gives a question no tier and no alert block", () => {
		expect(prompt).toContain("A question has no tier at all");
		expect(prompt).toContain("its `body` carries no alert block");
	});

	it("asks explanations to record whether the reason was read or reconstructed", () => {
		expect(prompt).toContain("Set `grounding` on every explanation");
		expect(prompt).toContain("Nobody is ever shown this field.");
		expect(prompt).toContain(
			"that is the signal to ask it as a question rather than write a confident reason nobody checked",
		);
	});

	it("requires the finding to argue from evidence rather than taste", () => {
		expect(prompt).toContain("**Argue from evidence, never from taste.**");
	});

	it("instructs structured output rather than a scratchfile", () => {
		expect(prompt).not.toContain("review-notes");
		expect(prompt).not.toContain("scratchfile");
	});

	it("carries the numbered diff", () => {
		expect(prompt).toContain(renderNumberedDiff([FILE]));
	});
});

describe("buildReviewPrompt with a previous pass", () => {
	const prompt = buildReviewPrompt({
		announce: "reviewing PR #42 (base main, head feature-x)",
		files: [FILE],
		previous: {
			createdAt: "2026-08-20T00:00:00.000Z",
			overview: "adds the greeting",
			verdict: "matches the ticket",
			findings: [
				{
					id: "finding-0",
					tier: "should-fix",
					title: "Greeting drops the name",
					body: "The reader's own rewrite of the body.",
					path: "src/greeting.ts",
					startLine: 2,
					endLine: 2,
					dismissed: false,
					edited: true,
				},
				{
					id: "finding-1",
					tier: "nitpick",
					title: "Prefer template literals",
					body: "Use a template literal here.",
					path: "src/greeting.ts",
					startLine: 2,
					endLine: 2,
					dismissed: true,
					edited: false,
				},
			],
			conversation: [
				{
					author: "alice",
					path: "src/greeting.ts",
					line: 2,
					body: "This is intentional, see the ticket.",
					isReply: false,
				},
				{
					author: "bob",
					path: "src/greeting.ts",
					line: 2,
					body: "Agreed, leaving as is.",
					isReply: true,
				},
			],
		},
	});

	it("frames the previous pass as prior notes with the resolution rules", () => {
		expect(prompt).toContain("## Previous review");
		expect(prompt).toContain("is resolved: do not re-emit it");
		expect(prompt).toContain("re-anchor it to the numbered diff below");
		expect(prompt).toContain("dismissed was removed by the reviewer");
		expect(prompt).toContain("reviewed fresh, as if for the first time");
	});

	it("renders each previous finding with its curated body and flags", () => {
		expect(prompt).toContain(
			"1. [finding-0] (should-fix) Greeting drops the name @ src/greeting.ts:2-2 [wording edited by the reviewer]",
		);
		expect(prompt).toContain("The reader's own rewrite of the body.");
		expect(prompt).toContain("[dismissed by the reviewer]");
	});

	it("renders the GitHub conversation, replies marked", () => {
		expect(prompt).toContain("### Conversation on GitHub");
		expect(prompt).toContain("alice on src/greeting.ts:2");
		expect(prompt).toContain("reply by bob");
	});

	it("says so when the previous pass had no findings", () => {
		const clean = buildReviewPrompt({
			announce: "reviewing",
			files: [FILE],
			previous: {
				createdAt: "2026-08-20T00:00:00.000Z",
				overview: "o",
				verdict: "v",
				findings: [],
				conversation: null,
			},
		});
		expect(clean).toContain("It had no findings.");
		expect(clean).not.toContain("### Conversation on GitHub");
	});
});

const UNCHANGED_FILE: FileDiff = {
	...FILE,
	id: "f2",
	path: "src/settled.ts",
	hunks: [
		{
			id: "h2",
			header: "",
			oldStart: 1,
			oldLines: 1,
			newStart: 1,
			newLines: 1,
			lines: [{ type: "add", content: "const settled = true;", newLine: 1 }],
		},
	],
};

describe("buildReviewPrompt with a reuse plan", () => {
	const prompt = buildReviewPrompt({
		announce: "reviewing PR #42",
		files: [FILE, UNCHANGED_FILE],
		previous: {
			createdAt: "2026-08-20T00:00:00.000Z",
			overview: "adds the greeting",
			verdict: "matches the ticket",
			findings: [
				{
					id: "finding-0",
					tier: "should-fix",
					title: "Settled file still leaks",
					body: "It leaks.",
					path: "src/settled.ts",
					startLine: 1,
					endLine: 1,
					dismissed: false,
					edited: false,
					carried: { movedDependencies: [], unrecorded: false },
				},
				{
					id: "finding-1",
					tier: "nitpick",
					title: "Settled file names it oddly",
					body: "Odd name.",
					path: "src/settled.ts",
					startLine: 1,
					endLine: 1,
					dismissed: false,
					edited: false,
					carried: {
						movedDependencies: ["src/greeting.ts"],
						unrecorded: false,
					},
				},
			],
			conversation: null,
		},
		reuse: {
			baseMoved: false,
			changedPaths: ["src/greeting.ts"],
			addedPaths: [],
			removedPaths: ["src/dropped.ts"],
			unchanged: [
				{
					path: "src/settled.ts",
					findingIds: ["finding-0", "finding-1"],
					explanations: [
						{ topic: "Settling the flag", says: ["It settles.", "For good."] },
					],
				},
			],
			recheckIds: ["finding-1"],
		},
	});

	it("renders the diff of the files that moved and not of the ones that did not", () => {
		expect(prompt).toContain("### src/greeting.ts");
		expect(prompt).not.toContain("### src/settled.ts —");
		expect(prompt).not.toContain("const settled = true;");
	});

	it("inventories each unchanged file with what the last pass said about it", () => {
		expect(prompt).toContain("- `src/settled.ts`");
		expect(prompt).toContain("carried findings: finding-0, finding-1");
		expect(prompt).toContain(
			'explanation (topic "Settling the flag"): It settles. For good.',
		);
	});

	it("states what moved, including the files that left the change", () => {
		expect(prompt).toContain("- Changed: `src/greeting.ts`");
		expect(prompt).toContain("- Gone from the change: `src/dropped.ts`");
		expect(prompt).toContain("- Unchanged, byte for byte: `src/settled.ts`");
		expect(prompt).toContain("The base commit is the one the previous pass");
	});

	it("marks a carried finding as standing, and a re-check with what moved under it", () => {
		expect(prompt).toContain(
			"[carried: its file has not changed since you reviewed it]",
		);
		expect(prompt).toContain(
			"[carried, RE-CHECK: `src/greeting.ts` moved since you verified it]",
		);
	});

	it("asks for a verdict on exactly the re-checked ids", () => {
		expect(prompt).toContain("Re-check exactly these");
		expect(prompt).toContain("finding-1");
		expect(prompt).toContain("An id outside that list is ignored.");
	});
});

describe("buildReviewPrompt with a previous pass but no reuse plan", () => {
	it("renders every file and asks for the whole diff to be reviewed", () => {
		const prompt = buildReviewPrompt({
			announce: "reviewing PR #42",
			files: [FILE, UNCHANGED_FILE],
			previous: {
				createdAt: "2026-08-20T00:00:00.000Z",
				overview: "adds the greeting",
				verdict: "matches the ticket",
				findings: [],
				conversation: null,
			},
		});

		expect(prompt).toContain("### src/settled.ts");
		expect(prompt).toContain("const settled = true;");
		expect(prompt).toContain("review the CURRENT diff at the bottom");
		expect(prompt).not.toContain("## Since the last review");
	});
});
