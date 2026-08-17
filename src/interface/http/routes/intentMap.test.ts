import { describe, expect, it } from "vitest";
import {
	analyze,
	createAnalysisApp,
} from "../../../../test/helpers/createAnalysisApp";
import { intentMapDtoSchema } from "../dto/IntentMapDto";

describe("GET /api/intent-map", () => {
	it("404s with not-produced until an analysis has run", async () => {
		const app = await createAnalysisApp();
		const response = await app.app.request("/api/intent-map");

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ reason: "not-produced" });
	});

	it("serves the map stage A produced, with whole-file members spelled out", async () => {
		const app = await createAnalysisApp();
		await analyze(app);

		const response = await app.app.request("/api/intent-map");
		expect(response.status).toBe(200);
		const intentMap = intentMapDtoSchema.parse(await response.json());

		expect(intentMap.summary).toContain("reviewer");
		expect(intentMap.suggestedEntryPoint).toBe("src/greeting.ts");
		expect(intentMap.clusters.map((cluster) => cluster.kind)).toEqual([
			"core",
			"docs",
		]);
		expect(intentMap.clusters[0].members[0].hunkIds.length).toBe(1);
		// the agent named this member without hunk precision; the wire says so
		// with an empty list rather than an absent field
		expect(intentMap.clusters[1].members[0].hunkIds).toEqual([]);
	});

	it("carries nothing about risk (ALT-008)", async () => {
		const app = await createAnalysisApp();
		await analyze(app);

		const body = await (await app.app.request("/api/intent-map")).text();
		expect(body).not.toContain("risk");
		expect(body).not.toContain("hunkRisks");
	});
});
