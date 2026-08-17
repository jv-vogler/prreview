import { describe, expect, it } from "vitest";
import {
	type AnalysisApp,
	analyze,
	createAnalysisApp,
} from "../../../../test/helpers/createAnalysisApp";
import { readSseFrames } from "../../../../test/helpers/readSse";
import { serverEventSchema } from "../dto/ServerEvent";
import { walkthroughDtoSchema } from "../dto/WalkthroughDto";
import { walkthroughProgressResponseSchema } from "../dto/WalkthroughProgressPut";

function putProgress(app: AnalysisApp, body: unknown) {
	return app.app.request("/api/walkthrough/progress", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("GET /api/walkthrough", () => {
	it("404s with not-produced until an analysis has run", async () => {
		const app = await createAnalysisApp();
		const response = await app.app.request("/api/walkthrough");

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ reason: "not-produced" });
	});

	it("serves the steps in reading order, numbered by the server", async () => {
		const app = await createAnalysisApp();
		await analyze(app);

		const response = await app.app.request("/api/walkthrough");
		expect(response.status).toBe(200);
		const walkthrough = walkthroughDtoSchema.parse(await response.json());
		expect(walkthrough.steps.map((step) => step.index)).toEqual([0, 1]);
		expect(walkthrough.steps[0].title).toContain("greeting");
		expect(walkthrough.steps[0].focus[0].hunkIds).toHaveLength(1);
	});
});

describe("PUT /api/walkthrough/progress", () => {
	it("records the step and marks its hunks viewed in one answer", async () => {
		const app = await createAnalysisApp();
		await analyze(app);

		const response = await putProgress(app, { position: 0, completed: false });
		expect(response.status).toBe(200);
		const body = walkthroughProgressResponseSchema.parse(await response.json());
		expect(body.progress).toEqual({ position: 0, completed: false });
		expect(body.coverage.total).toBeGreaterThan(0);

		const hunkId = app.review.files[0].hunks[0].id;
		const coverage = await app.store.loadCoverage(
			app.review.manifest.changesetId,
		);
		expect(coverage[hunkId]).toBe("viewed");
		const session = (await (await app.app.request("/api/session")).json()) as {
			analysis: { walkthroughProgress?: { position: number } };
		};
		expect(session.analysis.walkthroughProgress?.position).toBe(0);
	});

	it("broadcasts coverage.updated for the hunks the step moved", async () => {
		const app = await createAnalysisApp();
		await analyze(app);
		const events = await app.app.request("/api/events");
		if (events.body === null) {
			throw new Error("the SSE response carried no body");
		}

		await putProgress(app, { position: 1, completed: true });
		const [frame] = await readSseFrames(events.body, 1);
		const event = serverEventSchema.parse(JSON.parse(frame.data));
		expect(event.type).toBe("coverage.updated");
		if (event.type !== "coverage.updated") {
			throw new Error("expected a coverage event");
		}
		expect(event.updates.map((update) => update.state)).toEqual(["viewed"]);

		await events.body.cancel();
	});

	it("never downgrades a hunk already reviewed (monotonic)", async () => {
		const app = await createAnalysisApp();
		await analyze(app);
		const hunkId = app.review.files[0].hunks[0].id;
		await app.app.request("/api/coverage", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ updates: [{ hunkId, state: "reviewed" }] }),
		});

		await putProgress(app, { position: 0, completed: false });

		const coverage = await app.store.loadCoverage(
			app.review.manifest.changesetId,
		);
		expect(coverage[hunkId]).toBe("reviewed");
	});

	it("400s a step this walkthrough does not have", async () => {
		const app = await createAnalysisApp();
		await analyze(app);

		const response = await putProgress(app, { position: 99, completed: false });
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ reason: "validation" });
	});

	it("400s a negative position without reaching the use-case", async () => {
		const app = await createAnalysisApp();
		const response = await putProgress(app, { position: -1, completed: false });

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ reason: "validation" });
	});

	it("404s with not-produced when nothing has been analyzed", async () => {
		const app = await createAnalysisApp();
		const response = await putProgress(app, { position: 0, completed: false });

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ reason: "not-produced" });
	});
});
