import { describe, expect, it } from "vitest";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { depthForPreset } from "../../domain/review/ReviewDepth";
import { adjudicate, type LensResult } from "./adjudicate";
import type { ReviewFinding } from "./reviewSchemas";

/**
 * Adjudication decides what a reviewer sees, and every decision it makes is
 * one a second agent call could hallucinate instead — which is why it is
 * deterministic, and why it is worth asserting directly.
 *
 * These cases are the falsifiability harness for the three gates: break the
 * confidence floor, the form gate, or the grounding check, and exactly one of
 * them goes red.
 */

const PATH = "src/greeting.ts";
const WORKSPACE = "/tmp/prreview-worktree/abc123";

const FILES: FileDiff[] = [
	{
		id: "F1",
		path: PATH,
		status: "modified",
		additions: 2,
		deletions: 1,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: null,
		hunks: [
			{
				id: "F1h1",
				header: "@@ -1,3 +1,4 @@",
				oldStart: 1,
				oldLines: 3,
				newStart: 1,
				newLines: 4,
				lines: [
					{
						type: "add",
						content: "const retries = config.maxRetries;",
						newLine: 3,
					},
				],
			},
		],
	},
];

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
	return {
		title: "Retries hammer a failing endpoint",
		body: "Callers passing their own punctuation get it doubled, so a retry storm reaches the endpoint. `greet(name, true)` appends the suffix unconditionally.",
		anchor: { path: PATH, side: "new", startLine: 3, endLine: 3 },
		severity: "should-fix",
		category: "correctness",
		confidence: 90,
		proof: { mode: "traced", how: "read greet and both call sites" },
		...overrides,
	} as ReviewFinding;
}

function lens(
	name: string,
	findings: ReviewFinding[],
	reads: { path: string; offset?: number; limit?: number }[] = [
		{ path: `${WORKSPACE}/${PATH}` },
	],
	relatedFindings: ReviewFinding[] = [],
): LensResult {
	return {
		lens: name,
		out: { findings, relatedFindings },
		readLog: { reads, searchHits: [] },
	};
}

function run(results: LensResult[], preset: "light" | "standard" = "standard") {
	return adjudicate({
		results,
		depth: depthForPreset(preset),
		files: FILES,
		workspaceDir: WORKSPACE,
	});
}

describe("adjudicate", () => {
	it("keeps a grounded, well-formed finding and says the gate passed", () => {
		const result = run([lens("correctness", [finding()])]);

		expect(result.findings).toHaveLength(1);
		expect(result.findings[0]?.groundingVerified).toBe(true);
		expect(result.findings[0]?.marks).toEqual([]);
		expect(result.discarded).toEqual([]);
	});

	// ── what gets thrown away, and why ──────────────────────────────────────

	it("records the confidence floor's own numbers on the discard", () => {
		const result = run([lens("correctness", [finding({ confidence: 62 })])]);

		expect(result.findings).toHaveLength(0);
		expect(result.discarded).toEqual([
			{
				title: "Retries hammer a failing endpoint",
				species: "finding",
				severity: "should-fix",
				lenses: ["correctness"],
				reason: { kind: "below-confidence-floor", confidence: 62, floor: 80 },
			},
		]);
	});

	it("names every form rule a body broke", () => {
		const result = run([
			lens("correctness", [
				finding({
					body: "It's worth noting that this could be a problem. And another sentence. And a third one before any evidence at all.",
				}),
			]),
		]);

		expect(result.findings).toHaveLength(0);
		const [discarded] = result.discarded;
		expect(discarded?.reason.kind).toBe("form");
		if (discarded?.reason.kind !== "form") {
			throw new Error("expected a form discard");
		}
		expect(discarded.reason.rules).toContain("prose-tell");
		expect(discarded.reason.rules).toContain("lead-too-long");
	});

	/**
	 * The asymmetry is the point: a confidently-worded blocker about code nobody
	 * opened costs the reader's trust in everything else on the page, and a
	 * nitpick in the same state costs a shrug.
	 */
	it("drops an ungrounded blocker and names the path it could not verify", () => {
		const result = run([
			lens("security", [finding({ severity: "blocker" })], []),
		]);

		expect(result.findings).toHaveLength(0);
		expect(result.discarded[0]?.reason).toEqual({
			kind: "ungrounded-blocker",
			path: PATH,
			why: "never-opened",
		});
	});

	it("keeps a lower-severity ungrounded finding and marks which citation failed", () => {
		const result = run([
			lens("design", [finding({ severity: "consider" })], []),
		]);

		expect(result.findings).toHaveLength(1);
		expect(result.findings[0]?.groundingVerified).toBe(false);
		expect(result.findings[0]?.marks).toEqual([
			{ kind: "ungrounded-citation", path: PATH },
		]);
	});

	it("marks an inferred path even when the citation checked out", () => {
		const result = run([
			lens("correctness", [
				finding({
					proof: { mode: "inferred", how: "did not open the caller" },
				}),
			]),
		]);

		expect(result.findings[0]?.marks).toEqual([{ kind: "inferred-path" }]);
	});

	// ── line-level grounding, unreachable until the ranges were recorded ─────

	it("refuses a citation outside every range the round actually read", () => {
		const result = run([
			lens(
				"correctness",
				[finding({ severity: "blocker" })],
				// the file was opened at lines 100-140; the claim is about line 3
				[{ path: `${WORKSPACE}/${PATH}`, offset: 100, limit: 40 }],
			),
		]);

		expect(result.discarded[0]?.reason).toEqual({
			kind: "ungrounded-blocker",
			path: PATH,
			why: "outside-read-range",
		});
	});

	it("accepts a citation inside the range that was read", () => {
		const result = run([
			lens(
				"correctness",
				[finding()],
				[{ path: `${WORKSPACE}/${PATH}`, offset: 1, limit: 50 }],
			),
		]);

		expect(result.findings[0]?.groundingVerified).toBe(true);
	});

	/**
	 * Lenses fork the comprehension session, so each child's log holds only what
	 * *it* opened. A claim resting on a file the round read is grounded whichever
	 * child happened to open it — and `fresh-eyes`, which reads nothing at all,
	 * depends on exactly this.
	 */
	it("grounds a claim against the union of the round's read logs", () => {
		const result = run([
			lens("fresh-eyes", [finding({ severity: "blocker" })], []),
			lens("correctness", []),
		]);

		expect(result.findings).toHaveLength(1);
		expect(result.findings[0]?.groundingVerified).toBe(true);
		expect(result.readLog.reads).toHaveLength(1);
	});

	// ── citations ───────────────────────────────────────────────────────────

	it("carries the evidence block as a citation, without the anchor", () => {
		const result = run([
			lens("correctness", [
				finding({
					evidence: {
						path: PATH,
						startLine: 3,
						endLine: 3,
						note: "the suffix is appended unconditionally",
					},
				}),
			]),
		]);

		expect(result.findings[0]?.citations).toEqual([
			{
				path: PATH,
				startLine: 3,
				endLine: 3,
				note: "the suffix is appended unconditionally",
			},
		]);
	});

	it("cites nothing when the finding carried no evidence", () => {
		const result = run([lens("correctness", [finding()])]);

		expect(result.findings[0]?.citations).toEqual([]);
	});

	it("checks the evidence path too, not only the anchor", () => {
		const result = run([
			lens("correctness", [
				finding({
					severity: "consider",
					evidence: {
						path: "src/callers.ts",
						startLine: 9,
						endLine: 9,
						note: "the caller passes true",
					},
				}),
			]),
		]);

		expect(result.findings[0]?.marks).toEqual([
			{ kind: "ungrounded-citation", path: "src/callers.ts" },
		]);
	});

	// ── merging and ranking ─────────────────────────────────────────────────

	it("merges the same claim from two lenses and keeps both names", () => {
		const result = run([
			lens("correctness", [finding({ confidence: 84 })]),
			lens("security", [finding({ confidence: 88, severity: "blocker" })]),
		]);

		expect(result.findings).toHaveLength(1);
		expect(result.findings[0]?.lenses).toEqual(["correctness", "security"]);
		// the worse case and the higher confidence both survive the merge
		expect(result.findings[0]?.severity).toBe("blocker");
		expect(result.findings[0]?.confidence).toBe(88);
	});

	it("does not merge two claims of different categories at the same lines", () => {
		const result = run([
			lens("correctness", [finding()]),
			lens("security", [finding({ category: "security", title: "Injection" })]),
		]);

		expect(result.findings).toHaveLength(2);
	});

	/**
	 * Corroboration outranks confidence on purpose: a model's self-reported
	 * confidence is a number it produced about itself, while two independent
	 * lenses landing on the same lines is evidence from outside either one.
	 */
	it("ranks corroboration above a lone higher-confidence finding", () => {
		const result = run([
			lens("correctness", [finding({ confidence: 84 })]),
			lens("security", [finding({ confidence: 84 })]),
			lens("design", [
				finding({
					confidence: 99,
					category: "design",
					title: "A lone stronger claim",
					anchor: { path: PATH, side: "new", startLine: 3, endLine: 3 },
				}),
			]),
		]);

		expect(result.findings.map((f) => f.lenses.length)).toEqual([2, 1]);
	});

	it("ranks a blocker above everything, whatever its confidence", () => {
		const result = run([
			lens("correctness", [finding({ confidence: 99 })]),
			lens("security", [
				finding({
					severity: "blocker",
					confidence: 81,
					category: "security",
					title: "A blocker",
				}),
			]),
		]);

		expect(result.findings[0]?.severity).toBe("blocker");
	});

	it("cuts the kept list to the depth's budget", () => {
		const light = depthForPreset("light");
		const many = Array.from({ length: light.maxFindings + 4 }, (_, index) =>
			finding({
				title: `Finding ${index}`,
				category: index % 2 === 0 ? "correctness" : "security",
				anchor: {
					path: PATH,
					side: "new",
					startLine: 3 + index * 10,
					endLine: 3 + index * 10,
				},
			}),
		);

		const result = adjudicate({
			results: [lens("correctness", many)],
			depth: light,
			files: FILES,
			workspaceDir: WORKSPACE,
		});

		expect(result.findings).toHaveLength(light.maxFindings);
	});

	// ── species discipline ──────────────────────────────────────────────────

	it("keeps related findings in their own list and says so on a discard", () => {
		const result = run([
			lens(
				"correctness",
				[],
				[{ path: `${WORKSPACE}/${PATH}` }],
				[
					finding({ title: "Already untested" }),
					finding({
						title: "Too unsure to raise",
						confidence: 40,
						category: "testing",
					}),
				],
			),
		]);

		expect(result.findings).toHaveLength(0);
		expect(result.relatedFindings).toHaveLength(1);
		expect(result.discarded[0]?.species).toBe("related-finding");
	});
});
