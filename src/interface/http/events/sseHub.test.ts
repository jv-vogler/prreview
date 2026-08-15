import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../../test/helpers/createTestApp";
import { readSseFrames } from "../../../../test/helpers/readSse";
import { serverEventSchema } from "../dto/ServerEvent";

const WAIT_STEP_MS = 5;
const WAIT_LIMIT_MS = 1_000;

async function waitFor(condition: () => boolean): Promise<void> {
	const deadline = Date.now() + WAIT_LIMIT_MS;
	while (!condition()) {
		if (Date.now() > deadline) {
			throw new Error("timed out waiting for a condition");
		}
		await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
	}
}

function requireBody(response: Response): ReadableStream<Uint8Array> {
	expect(response.status).toBe(200);
	if (response.body === null) {
		throw new Error("SSE response carried no body stream");
	}
	return response.body;
}

/**
 * In-process, "the tab went away" is the response stream being cancelled —
 * exactly what @hono/node-server does when the real socket closes; hono's
 * streaming API turns that cancellation into the stream's abort event.
 */
async function disconnect(body: ReadableStream<Uint8Array>): Promise<void> {
	await body.cancel();
}

describe("GET /api/events", () => {
	it("streams published events with monotonic ids and valid payloads", async () => {
		const { app, hub } = await createTestApp();
		const body = requireBody(await app.request("/api/events"));

		hub.publish({ type: "changeset.drifted" });
		hub.publish({
			type: "coverage.updated",
			updates: [{ hunkId: "h1", state: "viewed" }],
			summary: { total: 50, byFile: {} },
		});

		const frames = await readSseFrames(body, 2);
		expect(frames.map((frame) => frame.id)).toEqual([1, 2]);
		const events = frames.map((frame) =>
			serverEventSchema.parse(JSON.parse(frame.data)),
		);
		expect(events[0]).toEqual({ type: "changeset.drifted" });
		expect(events[1].type).toBe("coverage.updated");

		await disconnect(body);
	});

	it("answers with the event-stream content type", async () => {
		const { app } = await createTestApp();
		const response = await app.request("/api/events");
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		await disconnect(requireBody(response));
	});

	it("does not deliver events from before a fresh connection", async () => {
		const { app, hub } = await createTestApp();
		hub.publish({ type: "changeset.drifted" });

		const body = requireBody(await app.request("/api/events"));
		hub.publish({ type: "changeset.drifted" });

		const frames = await readSseFrames(body, 1);
		expect(frames[0].id).toBe(2);

		await disconnect(body);
	});

	it("replays missed events from the ring buffer on Last-Event-ID reconnect", async () => {
		const { app, hub } = await createTestApp();

		// connect, receive one event, then drop the connection
		const firstBody = requireBody(await app.request("/api/events"));
		hub.publish({ type: "changeset.drifted" });
		const firstFrames = await readSseFrames(firstBody, 1);
		expect(firstFrames[0].id).toBe(1);
		await disconnect(firstBody);
		await waitFor(() => hub.connectionCount() === 0);

		// the world moves while we are away
		hub.publish({
			type: "coverage.updated",
			updates: [{ hunkId: "h1", state: "viewed" }],
			summary: { total: 50, byFile: {} },
		});
		hub.publish({ type: "changeset.drifted" });

		// reconnect where we left off
		const secondBody = requireBody(
			await app.request("/api/events", {
				headers: { "Last-Event-ID": "1" },
			}),
		);
		const replayed = await readSseFrames(secondBody, 2);

		expect(replayed.map((frame) => frame.id)).toEqual([2, 3]);
		expect(JSON.parse(replayed[0].data).type).toBe("coverage.updated");
		expect(JSON.parse(replayed[1].data).type).toBe("changeset.drifted");

		await disconnect(secondBody);
	});

	it("emits heartbeats on the configured cadence", async () => {
		const { app, hub } = await createTestApp({ heartbeatIntervalMs: 10 });
		const body = requireBody(await app.request("/api/events"));

		const frames = await readSseFrames(body, 1);
		expect(JSON.parse(frames[0].data)).toEqual({ type: "heartbeat" });

		await disconnect(body);
		hub.stop();
	});

	it("counts connections for the lifecycle", async () => {
		const { app, hub, lifecycle } = await createTestApp();
		expect(hub.connectionCount()).toBe(0);

		const body = requireBody(await app.request("/api/events"));
		await waitFor(() => hub.connectionCount() === 1);
		expect(lifecycle.liveness()).toBe(1);

		await disconnect(body);
		await waitFor(() => hub.connectionCount() === 0);
		expect(lifecycle.liveness()).toBe(0);
	});
});
