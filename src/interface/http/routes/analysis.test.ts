import { describe, expect, it } from "vitest";
import {
	analyze,
	createAnalysisApp,
	settle,
	waitFor,
} from "../../../../test/helpers/createAnalysisApp";
import { createTestApp } from "../../../../test/helpers/createTestApp";
import { runConflictDtoSchema, runDtoSchema } from "../dto/RunDto";

function postAnalysis(app: Awaited<ReturnType<typeof createAnalysisApp>>) {
	return app.app.request("/api/analysis", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ task: "comprehension" }),
	});
}

describe("POST /api/analysis", () => {
	it("accepts a comprehension run with 202 and the runId", async () => {
		const app = await createAnalysisApp();
		const response = await postAnalysis(app);

		expect(response.status).toBe(202);
		const { runId } = (await response.json()) as { runId: string };
		expect(runId).not.toBe("");
		await settle(app, runId);
		expect(app.container.runManager.get(runId)?.status).toBe("succeeded");
	});

	it("409s with the existing runId while a run is in flight", async () => {
		const app = await createAnalysisApp();
		app.engine.options = {
			task: {
				events: app.engine.options.task?.events ?? [],
				blockBeforeResult: true,
			},
		};
		const accepted = await postAnalysis(app);
		const { runId } = (await accepted.json()) as { runId: string };
		await app.engine.started;

		const conflicted = await postAnalysis(app);
		expect(conflicted.status).toBe(409);
		const body = runConflictDtoSchema.parse(await conflicted.json());
		expect(body.reason).toBe("run-already-running");
		expect(body.existingRunId).toBe(runId);
		expect(body.message).not.toBe("");

		app.engine.releaseRun();
		await settle(app, runId);
	});

	it("rejects an unknown task type with 400 validation", async () => {
		const app = await createAnalysisApp();
		const response = await app.app.request("/api/analysis", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ task: "findings" }),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ reason: "validation" });
	});

	it("503s with agent-missing when no agent CLI was found (REQ-004)", async () => {
		const { app } = await createTestApp();
		const response = await app.request("/api/analysis", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ task: "comprehension" }),
		});

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ reason: "agent-missing" });
	});
});

describe("GET /api/analysis/runs", () => {
	it("lists this session's runs oldest first", async () => {
		const app = await createAnalysisApp();
		await analyze(app);

		const response = await app.app.request("/api/analysis/runs");
		expect(response.status).toBe(200);
		const runs = runDtoSchema.array().parse(await response.json());
		expect(runs).toHaveLength(1);
		expect(runs[0].stage).toBe("comprehension");
		expect(runs[0].lane).toBe("analysis");
		expect(runs[0].status).toBe("succeeded");
		expect(runs[0].startedAt).toBeDefined();
		expect(runs[0].endedAt).toBeDefined();
		expect(runs[0].skippedAnchors).toBe(0);
	});

	it("serves one run by id", async () => {
		const app = await createAnalysisApp();
		const runId = await analyze(app);

		const response = await app.app.request(`/api/analysis/runs/${runId}`);
		expect(response.status).toBe(200);
		expect(runDtoSchema.parse(await response.json()).id).toBe(runId);
	});

	it("404s an unknown run id — runs are ephemeral", async () => {
		const app = await createAnalysisApp();
		const response = await app.app.request("/api/analysis/runs/nope");

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ reason: "run-not-found" });
	});
});

describe("POST /api/analysis/runs/:id/cancel", () => {
	it("cancels a running run and answers 204", async () => {
		const app = await createAnalysisApp();
		app.engine.options = {
			task: {
				events: app.engine.options.task?.events ?? [],
				blockBeforeResult: true,
			},
		};
		const accepted = await postAnalysis(app);
		const { runId } = (await accepted.json()) as { runId: string };
		await app.engine.started;

		const response = await app.app.request(
			`/api/analysis/runs/${runId}/cancel`,
			{ method: "POST" },
		);
		expect(response.status).toBe(204);
		await settle(app, runId);
		expect(app.container.runManager.get(runId)?.status).toBe("cancelled");

		// cancellation reports immediately and tears down afterwards: the engine's
		// iterator only learns it was closed once the step it is parked on returns
		app.engine.releaseRun();
		await waitFor(app, () => app.engine.aborted);
	});

	it("404s cancelling a run that never existed", async () => {
		const app = await createAnalysisApp();
		const response = await app.app.request("/api/analysis/runs/nope/cancel", {
			method: "POST",
		});

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ reason: "run-not-found" });
	});
});
