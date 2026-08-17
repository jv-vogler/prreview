import { describe, expect, it } from "vitest";
import { serverEventSchema } from "../src/interface/http/dto/ServerEvent";
import {
	type AnalysisApp,
	createAnalysisApp,
} from "./helpers/createAnalysisApp";
import { readSseFrames } from "./helpers/readSse";

/**
 * The milestone's live promise, end to end over the server edge: a client
 * watching the one SSE channel sees an analysis start, every explanation land as
 * it is anchored, and the run finish — and sees a chat reply arrive as text
 * before the message it settles into.
 */

async function subscribe(
	app: AnalysisApp,
): Promise<ReadableStream<Uint8Array>> {
	const response = await app.app.request("/api/events");
	expect(response.status).toBe(200);
	if (response.body === null) {
		throw new Error("the SSE response carried no body");
	}
	return response.body;
}

function eventTypes(frames: { data: string }[]): string[] {
	return frames.map(
		(frame) => serverEventSchema.parse(JSON.parse(frame.data)).type,
	);
}

describe("one analysis, watched from the SSE channel", () => {
	it("streams run.started, an annotation per explanation, then run.succeeded", async () => {
		const app = await createAnalysisApp();
		const events = await subscribe(app);

		const accepted = await app.app.request("/api/analysis", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ task: "comprehension" }),
		});
		expect(accepted.status).toBe(202);

		const frames = await readSseFrames(events, 5);
		expect(eventTypes(frames)).toEqual([
			"run.queued",
			"run.started",
			"annotation.upserted",
			"annotation.upserted",
			"run.succeeded",
		]);
		const succeeded = serverEventSchema.parse(JSON.parse(frames[4].data));
		if (succeeded.type !== "run.succeeded") {
			throw new Error("expected the run to succeed");
		}
		expect(succeeded.run.stage).toBe("comprehension");
		expect(succeeded.run.skippedAnchors).toBe(0);

		await events.cancel();
	});

	it("streams a chat reply as coalesced text, then the stored message", async () => {
		const app = await createAnalysisApp();
		const events = await subscribe(app);

		const accepted = await app.app.request("/api/chat/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "why the new copy?" }),
		});
		expect(accepted.status).toBe(202);

		// run.queued, run.started, chat.turn.started, one coalesced delta,
		// chat.turn.completed, run.succeeded — the two token events arrive as one
		const frames = await readSseFrames(events, 6);
		expect(eventTypes(frames)).toEqual([
			"run.queued",
			"run.started",
			"chat.turn.started",
			"chat.turn.delta",
			"chat.turn.completed",
			"run.succeeded",
		]);
		const delta = serverEventSchema.parse(JSON.parse(frames[3].data));
		if (delta.type !== "chat.turn.delta") {
			throw new Error("expected a delta");
		}
		expect(delta.text).toBe("The greeting now names the reviewer.");

		await events.cancel();
	});
});
