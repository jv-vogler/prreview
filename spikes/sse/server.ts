/**
 * Minimal Hono SSE server for Spike 2: one event channel with monotonic ids,
 * a ring buffer, and Last-Event-ID replay — the shape ARCHITECTURE §8
 * prescribes, shrunk to spike size.
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

export const SSE_SERVER_PORT = 4993;
export const EMIT_INTERVAL_MS = 500;

const RING_BUFFER_SIZE = 100;

interface BufferedEvent {
	id: number;
	data: string;
}

type EventListener = (event: BufferedEvent) => void;

export function createSseApp() {
	const ringBuffer: BufferedEvent[] = [];
	const listeners = new Set<EventListener>();
	let nextEventId = 1;

	// Emit continuously (even with zero subscribers) so a reconnect has missed
	// events to replay.
	const emitter = setInterval(() => {
		const event: BufferedEvent = {
			id: nextEventId,
			data: JSON.stringify({ sequence: nextEventId, emittedAt: Date.now() }),
		};
		nextEventId++;
		ringBuffer.push(event);
		if (ringBuffer.length > RING_BUFFER_SIZE) ringBuffer.shift();
		for (const listener of listeners) listener(event);
	}, EMIT_INTERVAL_MS);
	emitter.unref?.();

	const app = new Hono();

	app.get("/api/events", (context) =>
		streamSSE(context, async (stream) => {
			const lastEventIdHeader = context.req.header("Last-Event-ID");
			if (lastEventIdHeader !== undefined) {
				const lastSeenId = Number(lastEventIdHeader);
				const missedEvents = ringBuffer.filter(
					(event) => event.id > lastSeenId,
				);
				for (const event of missedEvents) {
					await stream.writeSSE({
						id: String(event.id),
						event: "tick",
						data: event.data,
					});
				}
			}

			let releaseStream = () => {};
			const streamClosed = new Promise<void>((resolve) => {
				releaseStream = resolve;
			});
			const listener: EventListener = (event) => {
				void stream.writeSSE({
					id: String(event.id),
					event: "tick",
					data: event.data,
				});
			};
			listeners.add(listener);
			stream.onAbort(() => {
				listeners.delete(listener);
				releaseStream();
			});
			await streamClosed;
		}),
	);

	return app;
}
