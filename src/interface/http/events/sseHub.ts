import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ServerEvent } from "../dto/ServerEvent";

/** Keepalive cadence — frequent enough that proxies never time the stream out. */
const HEARTBEAT_INTERVAL_MS = 15_000;

export interface SseHubOptions {
	/** test seam; defaults to 15s */
	heartbeatIntervalMs?: number;
}

export interface SseHub {
	/** delivered to every currently-connected client; nobody connected = nobody misses it */
	publish(event: ServerEvent): void;
	/** the GET /api/events handler */
	handle(context: Context): Response | Promise<Response>;
	connectionCount(): number;
	/** clears the heartbeat timer (tests; production dies by process.exit) */
	stop(): void;
}

/**
 * The one SSE channel (TASK-035): run lifecycle and progress frames,
 * broadcast to whoever is connected right now.
 *
 * There is deliberately no replay ring buffer. A dropped SSE frame is
 * recovered by TASK-037's 8-second poll of `GET /api/review`, which is
 * always the current, authoritative state — a client that missed a frame
 * goes briefly stale, never permanently wrong, and a reconnect just resumes
 * hearing about whatever happens next.
 */
export function createSseHub(options: SseHubOptions = {}): SseHub {
	const connections = new Set<(event: ServerEvent) => void>();

	const heartbeatTimer = setInterval(() => {
		if (connections.size > 0) {
			broadcast({ type: "heartbeat" });
		}
	}, options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);
	// a keepalive must never keep the process itself alive
	heartbeatTimer.unref?.();

	function broadcast(event: ServerEvent): void {
		for (const deliver of connections) {
			deliver(event);
		}
	}

	return {
		publish(event) {
			broadcast(event);
		},

		handle(context) {
			return streamSSE(context, async (stream) => {
				const deliver = (event: ServerEvent): void => {
					void stream.writeSSE({ data: JSON.stringify(event) });
				};
				connections.add(deliver);

				let releaseStream = (): void => {};
				const streamClosed = new Promise<void>((resolve) => {
					releaseStream = resolve;
				});
				stream.onAbort(() => {
					connections.delete(deliver);
					releaseStream();
				});

				await streamClosed;
			});
		},

		connectionCount() {
			return connections.size;
		},

		stop() {
			clearInterval(heartbeatTimer);
		},
	};
}
