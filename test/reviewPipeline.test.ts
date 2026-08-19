import { describe, expect, it } from "vitest";
import type {
	ReviewFinding,
	ReviewOut,
} from "../src/application/review/reviewSchemas";
import type { FileDiff } from "../src/domain/changeset/FileDiff";
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

/** points every lens child at the same scripted answer */
function scriptReview(app: AnalysisApp, out: ReviewOut, readPaths: string[]) {
	app.engine.options = {
		...app.engine.options,
		task: {
			events: [
				fakeSession("review-session"),
				fakeResult({
					structuredOutput: out,
					sessionId: "review-session",
					readLog: { reads: readPaths, searchHits: [] },
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
