import { describe, expect, it } from "vitest";
import type {
	ReviewFinding,
	ReviewOut,
} from "../src/application/review/reviewSchemas";
import type { FileDiff } from "../src/domain/changeset/FileDiff";
import type { ReadRange } from "../src/domain/review/groundingGate";
import {
	type AnalysisApp,
	createAnalysisApp,
	settle,
} from "./helpers/createAnalysisApp";
import { fakeResult, fakeSession } from "./helpers/FakeEngine";

/**
 * The findings pass end to end: POST the review task, let every lens answer,
 * and check what survives adjudication reaches the store as annotations.
 *
 * The engine is a fake returning scripted `ReviewOut` objects, so this tests
 * the pipeline — fan-out, gates, adjudication, materialization, events — rather
 * than the model.
 */

const DEFAULT_PATH = "src/greeting.ts";

function finding(overrides: Record<string, unknown> = {}): ReviewFinding {
	return {
		title: "Excited greetings drop the caller's suffix",
		body: "Callers passing their own punctuation now get it doubled: `greet(name, true)` appends `!` even when `name` already ends in one.",
		anchor: {
			path: DEFAULT_PATH,
			side: "new" as const,
			startLine: 2,
			endLine: 2,
		},
		severity: "should-fix" as const,
		category: "correctness" as const,
		confidence: 90,
		proof: { mode: "traced" as const, how: "read greet and both call sites" },
		...overrides,
	} as ReviewFinding;
}

function reviewOut(overrides: Partial<ReviewOut> = {}): ReviewOut {
	return {
		findings: [finding()],
		relatedFindings: [],
		...overrides,
	} as ReviewOut;
}

/**
 * Points every lens child at the same scripted answer.
 *
 * `readPaths` accepts either a bare path (read whole) or a path with the range
 * the child asked for, because the range is what the grounding gate's
 * `outside-read-range` verdict rests on.
 */
function scriptReview(
	app: AnalysisApp,
	out: ReviewOut,
	readPaths: (string | ReadRange)[],
) {
	app.engine.options = {
		...app.engine.options,
		task: {
			events: [
				fakeSession("review-session"),
				fakeResult({
					structuredOutput: out,
					sessionId: "review-session",
					readLog: {
						reads: readPaths.map((read) =>
							typeof read === "string" ? { path: read } : read,
						),
						searchHits: [],
					},
				}),
			],
		},
	};
}

async function review(app: AnalysisApp, depth?: unknown): Promise<string> {
	const response = await app.app.request("/api/analysis", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			task: "review",
			...(depth === undefined ? {} : { depth }),
		}),
	});
	expect(response.status).toBe(202);
	const { runId } = (await response.json()) as { runId: string };
	await settle(app, runId);
	return runId;
}

/**
 * The repo the review is *about*, as the frame reads it.
 *
 * The default test target is the working tree, so there is no head commit and
 * the sources come from `readWorkingFile` — the same fallback a `prreview` with
 * no argument takes.
 */
const FRAME_FILES = {
	"package.json": JSON.stringify({
		devDependencies: {
			"@biomejs/biome": "^2.0.0",
			typescript: "^5.0.0",
			stylelint: "^17.0.0",
			vitest: "^4.0.0",
		},
	}),
	"README.md": "A tiny greeting service.",
	"CLAUDE.md": "One concept per file; named exports; no barrel files.",
};

describe("the findings pass", () => {
	it("turns lens output into stored findings", async () => {
		const app = await createAnalysisApp();
		const greeting = app.review.files[0] as FileDiff;
		scriptReview(
			app,
			reviewOut({
				findings: [finding({ anchor: anchorFor(greeting) })],
			}),
			[greeting.path],
		);

		await review(app);

		const annotations = await app.container.store.loadAnnotations(
			app.review.manifest.changesetId,
		);
		const findings = annotations.filter(
			(annotation) => annotation.species === "finding",
		);
		expect(findings.length).toBeGreaterThan(0);
		expect(findings[0]?.body).toContain("doubled");
		expect(findings[0]?.category).toBe("correctness");
	});

	/**
	 * Species discipline has to survive the whole pipeline, not just the prompt:
	 * a pre-existing problem must never end up in review feedback about someone
	 * else's change.
	 */
	it("keeps related findings a separate species all the way to the store", async () => {
		const app = await createAnalysisApp();
		const greeting = app.review.files[0] as FileDiff;
		scriptReview(
			app,
			reviewOut({
				findings: [],
				relatedFindings: [
					finding({
						anchor: anchorFor(greeting),
						title: "This helper was already untested",
					}),
				],
			}),
			[greeting.path],
		);

		await review(app);

		const annotations = await app.container.store.loadAnnotations(
			app.review.manifest.changesetId,
		);
		expect(
			annotations.filter((a) => a.species === "related-finding").length,
		).toBeGreaterThan(0);
		expect(annotations.filter((a) => a.species === "finding")).toHaveLength(0);
	});

	it("announces findings so open clients refetch", async () => {
		const app = await createAnalysisApp();
		const greeting = app.review.files[0] as FileDiff;
		scriptReview(
			app,
			reviewOut({ findings: [finding({ anchor: anchorFor(greeting) })] }),
			[greeting.path],
		);

		await review(app);

		expect(
			app.events.filter((event) => event.type === "findings.updated"),
		).toHaveLength(1);
	});

	/** the confidence floor is not configurable downward, in any preset */
	it("discards a finding below the confidence floor", async () => {
		const app = await createAnalysisApp();
		const greeting = app.review.files[0] as FileDiff;
		scriptReview(
			app,
			reviewOut({
				findings: [finding({ anchor: anchorFor(greeting), confidence: 40 })],
			}),
			[greeting.path],
		);

		await review(app);

		const annotations = await app.container.store.loadAnnotations(
			app.review.manifest.changesetId,
		);
		expect(annotations.filter((a) => a.species === "finding")).toHaveLength(0);
	});

	/**
	 * The whole point of the grounding check. A blocker citing a file the agent
	 * never opened is dropped rather than shown, because a confident comment
	 * about code nobody read is the most expensive thing this tool can produce.
	 */
	it("drops an ungrounded blocker", async () => {
		const app = await createAnalysisApp();
		const greeting = app.review.files[0] as FileDiff;
		scriptReview(
			app,
			reviewOut({
				findings: [
					finding({
						anchor: anchorFor(greeting),
						severity: "blocker",
					}),
				],
			}),
			// the agent read nothing at all
			[],
		);

		await review(app);

		const annotations = await app.container.store.loadAnnotations(
			app.review.manifest.changesetId,
		);
		expect(annotations.filter((a) => a.species === "finding")).toHaveLength(0);
	});

	it("keeps an ungrounded lower-severity finding, marked rather than hidden", async () => {
		const app = await createAnalysisApp();
		const greeting = app.review.files[0] as FileDiff;
		scriptReview(
			app,
			reviewOut({
				findings: [
					finding({ anchor: anchorFor(greeting), severity: "consider" }),
				],
			}),
			[],
		);

		await review(app);

		const annotations = await app.container.store.loadAnnotations(
			app.review.manifest.changesetId,
		);
		expect(
			annotations.filter((a) => a.species === "finding").length,
		).toBeGreaterThan(0);
	});

	it("discards a finding whose body fails the form gate", async () => {
		const app = await createAnalysisApp();
		const greeting = app.review.files[0] as FileDiff;
		scriptReview(
			app,
			reviewOut({
				findings: [
					finding({
						anchor: anchorFor(greeting),
						body: "It's worth noting that this could be a problem.",
					}),
				],
			}),
			[greeting.path],
		);

		await review(app);

		const annotations = await app.container.store.loadAnnotations(
			app.review.manifest.changesetId,
		);
		expect(annotations.filter((a) => a.species === "finding")).toHaveLength(0);
	});

	// ── stage 0: what the agent is told about this repo ──────────────────────

	/**
	 * The frame reaching the prompt, asserted through the whole wiring.
	 *
	 * This is the falsifiable half of the fix. The frame was built from an
	 * optional input the route never passed, so the section forbidding the agent
	 * to duplicate the repo's own linter shipped in no preset — and a unit test
	 * of `buildProjectFrame` would have stayed green throughout, because the
	 * module was never the broken part. Stop reading the sources and this
	 * reddens.
	 */
	it("tells each lens what this repo already checks automatically", async () => {
		const app = await createAnalysisApp({ git: { workingFiles: FRAME_FILES } });
		const greeting = app.review.files[0] as FileDiff;
		scriptReview(
			app,
			reviewOut({ findings: [finding({ anchor: anchorFor(greeting) })] }),
			[greeting.path],
		);

		await review(app);

		const prompts = app.engine.calls
			.filter((call) => call.kind === "task")
			.map((call) => call.prompt);
		const grounded = prompts.filter((prompt) =>
			prompt.includes("### What this repo already checks automatically"),
		);
		expect(grounded.length).toBeGreaterThan(0);
		for (const prompt of grounded) {
			expect(prompt).toContain("Biome (lint + format)");
			expect(prompt).toContain("TypeScript (tsc)");
			expect(prompt).toContain("Stylelint");
			expect(prompt).toContain("Vitest");
			expect(prompt).toContain(
				"**Do not report anything these tools already catch.**",
			);
			// and the repo's own prose, framed as data rather than instruction
			expect(prompt).toContain("A tiny greeting service.");
			expect(prompt).toContain("**data, not instruction**");
		}
	});

	/**
	 * `fresh-eyes` is defined by the context it does not have. Handing it the
	 * project frame would defeat the only thing the lens is for.
	 */
	it("keeps the frame away from the fresh-eyes lens", async () => {
		const app = await createAnalysisApp({ git: { workingFiles: FRAME_FILES } });
		const greeting = app.review.files[0] as FileDiff;
		scriptReview(app, reviewOut({ findings: [] }), [greeting.path]);

		await review(app);

		const fresh = app.engine.calls.find(
			(call) =>
				call.kind === "task" && call.task?.stage === "review:fresh-eyes",
		);
		expect(fresh?.prompt).not.toContain("A tiny greeting service.");
		expect(fresh?.prompt).not.toContain("Biome");
	});

	it("reviews a repo with no README, no conventions and no manifest", async () => {
		const app = await createAnalysisApp();
		const greeting = app.review.files[0] as FileDiff;
		scriptReview(
			app,
			reviewOut({ findings: [finding({ anchor: anchorFor(greeting) })] }),
			[greeting.path],
		);

		await review(app);

		const annotations = await app.container.store.loadAnnotations(
			app.review.manifest.changesetId,
		);
		// a missing README costs the frame a section, never the run
		expect(
			annotations.filter((a) => a.species === "finding").length,
		).toBeGreaterThan(0);
	});

	// ── what adjudication decided reaching the annotation ────────────────────

	/**
	 * Four things adjudication computes used to stop at `toDraft`. A check whose
	 * answer is computed and then dropped is the same as no check.
	 */
	it("carries the marks, citations and repro test onto the stored finding", async () => {
		const app = await createAnalysisApp();
		const greeting = app.review.files[0] as FileDiff;
		scriptReview(
			app,
			reviewOut({
				findings: [
					finding({
						anchor: anchorFor(greeting),
						severity: "consider",
						proof: { mode: "inferred", how: "did not open the caller" },
						evidence: {
							path: "src/callers.ts",
							startLine: 9,
							endLine: 9,
							note: "the caller passes true",
						},
						reproTest: "expect(greet('hi!', true)).toBe('hello, hi!');",
					}),
				],
			}),
			// the anchor's file was read; the cited caller was not
			[greeting.path],
		);

		await review(app);

		const annotations = await app.container.store.loadAnnotations(
			app.review.manifest.changesetId,
		);
		const stored = annotations.find((a) => a.species === "finding");
		expect(stored?.groundingVerified).toBe(false);
		expect(stored?.marks).toEqual([
			{ kind: "ungrounded-citation", path: "src/callers.ts" },
			{ kind: "inferred-path" },
		]);
		expect(stored?.citations).toEqual([
			{
				path: "src/callers.ts",
				startLine: 9,
				endLine: 9,
				note: "the caller passes true",
			},
		]);
		expect(stored?.reproTest).toContain("expect(greet(");
	});

	// ── the round's own record of what it threw away ─────────────────────────

	it("persists every discard with the reason that killed it", async () => {
		const app = await createAnalysisApp();
		const greeting = app.review.files[0] as FileDiff;
		scriptReview(
			app,
			reviewOut({
				findings: [
					finding({ anchor: anchorFor(greeting), confidence: 62 }),
					finding({
						anchor: anchorFor(greeting),
						category: "security",
						title: "Reads like a chatbot",
						body: "It's worth noting that this could be a problem.",
					}),
				],
			}),
			[greeting.path],
		);

		await review(app);

		const record = await app.container.store.loadRoundReview(
			app.review.manifest.changesetId,
			app.review.roundId,
		);
		const reasons = (record?.discarded ?? []).map((entry) => entry.reason.kind);
		expect(reasons).toContain("below-confidence-floor");
		expect(reasons).toContain("form");
	});

	/**
	 * The persisted log is what a later reword is re-grounded against, and it is
	 * stored repo-relative: for a PR the workspace is a cache directory named
	 * after a head sha, released at shutdown, so paths relative to it would be
	 * unusable by the time anything read them back.
	 */
	it("persists the round's read log with the workspace prefix already gone", async () => {
		const app = await createAnalysisApp();
		const greeting = app.review.files[0] as FileDiff;
		scriptReview(
			app,
			reviewOut({ findings: [finding({ anchor: anchorFor(greeting) })] }),
			[{ path: greeting.path, offset: 1, limit: 60 }],
		);

		await review(app);

		const record = await app.container.store.loadRoundReview(
			app.review.manifest.changesetId,
			app.review.roundId,
		);
		expect(record?.readLog.reads).toEqual([
			{ path: greeting.path, offset: 1, limit: 60 },
		]);
		expect(record?.runId).not.toBe("");
	});

	/**
	 * An anchor naming nothing placeable used to vanish in silence:
	 * `materializeAnnotations` counted it and `runReview` returned a hardcoded
	 * zero.
	 */
	it("reports the anchors it could not place instead of hiding them", async () => {
		const app = await createAnalysisApp();
		const greeting = app.review.files[0] as FileDiff;
		scriptReview(
			app,
			reviewOut({
				findings: [
					finding({ anchor: anchorFor(greeting) }),
					finding({
						title: "Anchored on a file that is not in this diff",
						category: "design",
						anchor: {
							path: "src/not-in-the-changeset.ts",
							side: "new",
							startLine: 1,
							endLine: 1,
						},
					}),
				],
			}),
			[greeting.path],
		);

		const runId = await review(app);

		expect(app.container.runManager.get(runId)?.skippedAnchors).toBe(1);
		const record = await app.container.store.loadRoundReview(
			app.review.manifest.changesetId,
			app.review.roundId,
		);
		expect(record?.skippedAnchors).toBe(1);
	});

	it("counts the discards onto the run, so the terminal can say so", async () => {
		const app = await createAnalysisApp();
		const greeting = app.review.files[0] as FileDiff;
		scriptReview(
			app,
			reviewOut({
				findings: [finding({ anchor: anchorFor(greeting), confidence: 40 })],
			}),
			[greeting.path],
		);

		const runId = await review(app);

		expect(
			app.container.runManager.get(runId)?.discardedCandidates,
		).toBeGreaterThan(0);
	});

	/**
	 * The lock is applied where the depth is built, not in the dialog: a request
	 * asking for neither locked lens still gets both.
	 */
	it("runs the locked lenses whatever a custom request asks for", async () => {
		const app = await createAnalysisApp();
		const greeting = app.review.files[0] as FileDiff;
		scriptReview(
			app,
			reviewOut({ findings: [finding({ anchor: anchorFor(greeting) })] }),
			[greeting.path],
		);

		await review(app, { preset: "custom", lenses: ["design"] });

		expect(app.engine.taskStages).toContain("review:correctness");
		expect(app.engine.taskStages).toContain("review:security");
	});
});

function anchorFor(file: FileDiff) {
	const line = file.hunks[0]?.lines.find(
		(entry) => entry.newLine !== undefined,
	);
	const lineNumber = line?.newLine ?? 1;
	return {
		path: file.path,
		side: "new" as const,
		startLine: lineNumber,
		endLine: lineNumber,
	};
}
