import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ServerEvent } from "../dto/ServerEvent";

const HEARTBEAT_INTERVAL_MS = 15_000;

export interface SseHubOptions {
	heartbeatIntervalMs?: number;
}

export interface SseHub {
	publish(event: ServerEvent): void;
	handle(context: Context): Response | Promise<Response>;
	connectionCount(): number;
	stop(): void;
}

export function createSseHub(options: SseHubOptions = {}): SseHub {
	const connections = new Set<(event: ServerEvent) => void>();

	const heartbeatTimer = setInterval(() => {
		if (connections.size > 0) {
			broadcast({ type: "heartbeat" });
		}
	}, options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);

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
