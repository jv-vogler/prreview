import { describe, expect, it } from "vitest";
import { sessionDtoSchema } from "../src/interface/http/dto/SessionDto";
import { createTestApp, TEST_HEAD_SHA } from "./helpers/createTestApp";

/**
 * F12's promise as an executable test (REQ-004): with no agent CLI, prreview is
 * the M1 viewer. Every AI endpoint answers honestly — an empty set where a set is
 * the right answer, 503 `agent-missing` where work was asked for — and nothing
 * M1 served changes.
 */

async function viewerOnlyApp() {
	// the default container has agent {kind: 'none'} and therefore engine null
	return createTestApp({
		git: {
			blobs: {
				[`${TEST_HEAD_SHA}:src/greeting.ts`]: Buffer.from(
					'export function greeting(): string {\n\treturn "hello";\n}\n',
				),
			},
		},
	});
}

function post(
	app: Awaited<ReturnType<typeof viewerOnlyApp>>["app"],
	path: string,
	body: unknown,
) {
	return app.request(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("with no agent CLI", () => {
	it("reports an agentless toolchain and an empty analysis block", async () => {
		const { app } = await viewerOnlyApp();
		const session = sessionDtoSchema.parse(
			await (await app.request("/api/session")).json(),
		);

		expect(session.toolchain.agent).toEqual({ kind: "none" });
		expect(session.analysis).toEqual({
			intentMapAvailable: false,
			walkthroughAvailable: false,
			annotationCount: 0,
		});
	});

	it("refuses analysis and chat with 503 agent-missing", async () => {
		const { app } = await viewerOnlyApp();

		const analysis = await post(app, "/api/analysis", {
			task: "comprehension",
		});
		expect(analysis.status).toBe(503);
		expect(await analysis.json()).toMatchObject({ reason: "agent-missing" });

		const chat = await post(app, "/api/chat/messages", { text: "hello?" });
		expect(chat.status).toBe(503);
		expect(await chat.json()).toMatchObject({ reason: "agent-missing" });
	});

	it("serves the empty reads instead of failing them", async () => {
		const { app } = await viewerOnlyApp();

		expect(await (await app.request("/api/annotations")).json()).toEqual([]);
		expect(await (await app.request("/api/chat/messages")).json()).toEqual([]);
		const runs = await app.request("/api/analysis/runs");
		expect(runs.status).toBe(200);
		expect(await runs.json()).toEqual([]);
	});

	it("404s the artifacts stage A would have produced", async () => {
		const { app } = await viewerOnlyApp();

		for (const path of ["/api/intent-map", "/api/walkthrough"]) {
			const response = await app.request(path);
			expect(response.status, path).toBe(404);
			expect(await response.json()).toMatchObject({ reason: "not-produced" });
		}
	});

	it("leaves every M1 endpoint exactly as it was", async () => {
		const { app, review } = await viewerOnlyApp();
		const hunkId = review.files[0].hunks[0].id;

		expect((await app.request("/api/changeset")).status).toBe(200);
		expect(
			(
				await app.request(
					`/api/blob?ref=${review.ref.baseSha}&path=${encodeURIComponent("src/greeting.ts")}`,
				)
			).status,
		).toBe(200);
		const coverage = await app.request("/api/coverage", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ updates: [{ hunkId, state: "viewed" }] }),
		});
		expect(coverage.status).toBe(200);
		expect((await coverage.json()) as { total: number }).toMatchObject({
			total: expect.any(Number),
		});
		expect((await app.request("/api/goodbye", { method: "POST" })).status).toBe(
			204,
		);
	});
});
