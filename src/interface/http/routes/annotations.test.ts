import { describe, expect, it } from "vitest";
import {
	analyze,
	createAnalysisApp,
	seedFindings,
} from "../../../../test/helpers/createAnalysisApp";
import { createTestApp } from "../../../../test/helpers/createTestApp";
import { annotationDtoSchema } from "../dto/AnnotationDto";

describe("GET /api/annotations", () => {
	it("is empty before anything has been analyzed", async () => {
		const app = await createAnalysisApp();
		const response = await app.app.request("/api/annotations");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual([]);
	});

	it("serves the findings a run produced, anchored", async () => {
		const app = await createAnalysisApp();
		await analyze(app);
		await seedFindings(app);

		const response = await app.app.request("/api/annotations");
		expect(response.status).toBe(200);
		const annotations = annotationDtoSchema
			.array()
			.parse(await response.json());

		expect(annotations).toHaveLength(2);
		expect(annotations.map((annotation) => annotation.species)).toEqual([
			"finding",
			"finding",
		]);
		expect(annotations.map((annotation) => annotation.anchor.path)).toEqual([
			"src/greeting.ts",
			"notes/todo.md",
		]);
		expect(annotations.map((annotation) => annotation.category)).toEqual([
			"correctness",
			"design",
		]);
		expect(annotations[0].anchor.placement).toBe("in-diff");
		expect(annotations[0].anchorStatus).toBe("anchored");
		expect(annotations[0].provenance.roundId).toBe("r1");
	});

	it("keeps the anchor snapshot off the wire", async () => {
		const app = await createAnalysisApp();
		await analyze(app);
		await seedFindings(app);

		const [annotation] = (await (
			await app.app.request("/api/annotations")
		).json()) as { anchor: Record<string, unknown> }[];
		expect(annotation.anchor).not.toHaveProperty("snapshot");
		expect(Object.keys(annotation.anchor).sort()).toEqual([
			"endLine",
			"fileId",
			"path",
			"placement",
			"side",
			"startLine",
		]);
	});

	it("answers an empty list with no agent rather than an error (REQ-004)", async () => {
		const { app } = await createTestApp();
		const response = await app.request("/api/annotations");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual([]);
	});
});

describe("POST /api/annotations/ops", () => {
	/**
	 * A reword is re-grounded against what the **findings pass** read.
	 *
	 * It used to be handed the comprehension pass's log with an empty workspace
	 * dir, which is wrong twice over: the lenses fork that session so each
	 * child's log holds only what it opened, and an empty workspace dir disables
	 * the prefix stripping the comparison depends on. The result was a reword
	 * losing its verified stamp essentially every time. These two cases are the
	 * pair that fails if anyone re-points it: the same rewrite, the same stored
	 * finding, and only the review's read log differs.
	 */
	async function rewordAgainst(
		reads: { path: string; offset?: number; limit?: number }[],
	) {
		const app = await createAnalysisApp();
		await seedFindings(app);
		await app.container.store.saveRoundReview(
			app.review.manifest.changesetId,
			app.review.roundId,
			{
				discarded: [],
				skippedAnchors: 0,
				readLog: { reads, searchHits: [] },
				runId: "run-review-1",
				producedAt: "2026-08-19T10:00:00.000Z",
			},
		);
		app.state.applyReview(null);

		const response = await app.app.request("/api/annotations/ops", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				ops: [
					{
						op: "reword",
						handle: "F1",
						body: "Callers that pass their own punctuation get it doubled, so the greeting reads badly. `greet(name, true)` appends the suffix unconditionally.",
					},
				],
			}),
		});
		expect(response.status).toBe(200);

		const stored = await app.container.store.loadAnnotations(
			app.review.manifest.changesetId,
		);
		return stored[0];
	}

	it("keeps the verified stamp when the review really read the cited file", async () => {
		const rewritten = await rewordAgainst([{ path: "src/greeting.ts" }]);

		expect(rewritten?.groundingVerified).toBe(true);
	});

	it("loses the verified stamp when the review never opened it", async () => {
		const rewritten = await rewordAgainst([{ path: "notes/todo.md" }]);

		expect(rewritten?.groundingVerified).toBe(false);
	});

	/** with no review on record nothing was read, so nothing is inherited */
	it("does not inherit a stamp when no review has run", async () => {
		const app = await createAnalysisApp();
		await seedFindings(app);

		const response = await app.app.request("/api/annotations/ops", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				ops: [
					{ op: "reword", handle: "F1", body: "A shorter, clearer claim." },
				],
			}),
		});

		expect(response.status).toBe(200);
		const stored = await app.container.store.loadAnnotations(
			app.review.manifest.changesetId,
		);
		expect(stored[0]?.groundingVerified).toBe(false);
	});
});
