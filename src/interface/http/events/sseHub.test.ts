import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { readSseFrames } from "../../../../test/helpers/readSse";
import type { ServerEvent } from "../dto/ServerEvent";
import { serverEventSchema } from "../dto/ServerEvent";
import { createSseHub } from "./sseHub";

const RUN_DTO = {
	id: "run-1",
	kind: "review" as const,
	status: "running" as const,
	queuedAt: "2026-08-21T10:00:00.000Z",
	idleTimeoutMs: 300_000,
};

function requireBody(response: Response): ReadableStream<Uint8Array> {
	expect(response.status).toBe(200);
	if (response.body === null) {
		throw new Error("SSE response carried no body stream");
	}
	return response.body;
}

async function disconnect(body: ReadableStream<Uint8Array>): Promise<void> {
	await body.cancel();
}

describe("createSseHub", () => {
	it("streams published events to a connected client", async () => {
		const hub = createSseHub();
		const app = new Hono();
		app.get("/events", (context) => hub.handle(context));

		const body = requireBody(await app.request("/events"));
		hub.publish({ type: "run.started", run: RUN_DTO });
		hub.publish({
			type: "run.succeeded",
			run: { ...RUN_DTO, status: "succeeded" },
		});

		const frames = await readSseFrames(body, 2);
		const events = frames.map((data) =>
			serverEventSchema.parse(JSON.parse(data)),
		);
		expect(events).toEqual([
			{ type: "run.started", run: RUN_DTO },
			{ type: "run.succeeded", run: { ...RUN_DTO, status: "succeeded" } },
		]);
		await disconnect(body);
	});

	it("answers with the event-stream content type", async () => {
		const hub = createSseHub();
		const app = new Hono();
		app.get("/events", (context) => hub.handle(context));

		const response = await app.request("/events");
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		await disconnect(requireBody(response));
	});

	it("does not deliver an event published before the connection existed", async () => {
		const hub = createSseHub();
		const app = new Hono();
		app.get("/events", (context) => hub.handle(context));

		hub.publish({ type: "run.started", run: RUN_DTO } satisfies ServerEvent);
		const body = requireBody(await app.request("/events"));
		hub.publish({
			type: "run.succeeded",
			run: { ...RUN_DTO, status: "succeeded" },
		});

		const [data] = await readSseFrames(body, 1);
		expect(JSON.parse(data ?? "{}").type).toBe("run.succeeded");
		await disconnect(body);
	});

	it("emits heartbeats on the configured cadence", async () => {
		const hub = createSseHub({ heartbeatIntervalMs: 10 });
		const app = new Hono();
		app.get("/events", (context) => hub.handle(context));

		const body = requireBody(await app.request("/events"));
		const [data] = await readSseFrames(body, 1);
		expect(JSON.parse(data ?? "{}")).toEqual({ type: "heartbeat" });
		await disconnect(body);
		hub.stop();
	});

	it("counts connections", async () => {
		const hub = createSseHub();
		const app = new Hono();
		app.get("/events", (context) => hub.handle(context));
		expect(hub.connectionCount()).toBe(0);

		const body = requireBody(await app.request("/events"));
		await waitFor(() => hub.connectionCount() === 1);

		await disconnect(body);
		await waitFor(() => hub.connectionCount() === 0);
	});
});

async function waitFor(condition: () => boolean): Promise<void> {
	const deadline = Date.now() + 1_000;
	while (!condition()) {
		if (Date.now() > deadline) {
			throw new Error("timed out waiting for a condition");
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}
