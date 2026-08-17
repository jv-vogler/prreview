import { describe, expect, it } from "vitest";
import {
	analyze,
	createAnalysisApp,
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

	it("serves the explanations an analysis produced, anchored", async () => {
		const app = await createAnalysisApp();
		await analyze(app);

		const response = await app.app.request("/api/annotations");
		expect(response.status).toBe(200);
		const annotations = annotationDtoSchema
			.array()
			.parse(await response.json());

		expect(annotations).toHaveLength(2);
		expect(annotations.map((annotation) => annotation.species)).toEqual([
			"explanation",
			"explanation",
		]);
		expect(annotations.map((annotation) => annotation.anchor.path)).toEqual([
			"src/greeting.ts",
			"notes/todo.md",
		]);
		expect(annotations.map((annotation) => annotation.category)).toEqual([
			"intent",
			"mechanism",
		]);
		expect(annotations[0].anchor.placement).toBe("in-diff");
		expect(annotations[0].anchorStatus).toBe("anchored");
		expect(annotations[0].provenance.roundId).toBe("r1");
	});

	it("keeps the anchor snapshot off the wire", async () => {
		const app = await createAnalysisApp();
		await analyze(app);

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
