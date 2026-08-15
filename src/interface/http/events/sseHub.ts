import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ServerEvent } from "../dto/ServerEvent";

/** Big enough to bridge any realistic reconnect gap (ARCHITECTURE §8). */
const RING_BUFFER_CAPACITY = 500;
/** Keepalive cadence — frequent enough that proxies never time the stream out. */
const HEARTBEAT_INTERVAL_MS = 15_000;
const LAST_EVENT_ID_HEADER = "Last-Event-ID";

interface StampedEvent {
	id: number;
	payload: string;
}

export interface SseHubOptions {
	/** liveness wiring: the lifecycle counts connections through these */
	onConnect?: () => void;
	onDisconnect?: () => void;
	/** test seam; defaults to 15s */
	heartbeatIntervalMs?: number;
}

export interface SseHub {
	/** the publisher API: updateCoverage and detectDrift results land here */
	publish(event: ServerEvent): void;
	/** the GET /api/events handler */
	handle(context: Context): Response | Promise<Response>;
	connectionCount(): number;
	/** clears the heartbeat timer (tests; production dies by process.exit) */
	stop(): void;
}

/**
 * THE single SSE channel (ARCHITECTURE §8): monotonic ids across every event,
 * a 500-event ring buffer replayed from `Last-Event-ID`, and a 15s heartbeat.
 * Events are sent as default `message` events whose data is the ServerEvent
 * JSON — the `type` discriminator lives in the payload, so the client parses
 * once and dispatches without per-type listeners. Heartbeats share the id
 * sequence but skip the ring buffer: replaying keepalives would only crowd
 * real events out of the 500-slot window.
 */
export function createSseHub(options: SseHubOptions = {}): SseHub {
	const ring: StampedEvent[] = [];
	const connections = new Set<(event: StampedEvent) => void>();
	let nextEventId = 1;

	function broadcast(event: ServerEvent, buffered: boolean): void {
		const stamped: StampedEvent = {
			id: nextEventId,
			payload: JSON.stringify(event),
		};
		nextEventId++;
		if (buffered) {
			ring.push(stamped);
			if (ring.length > RING_BUFFER_CAPACITY) {
				ring.shift();
			}
		}
		for (const deliver of connections) {
			deliver(stamped);
		}
	}

	const heartbeatTimer = setInterval(() => {
		if (connections.size > 0) {
			broadcast({ type: "heartbeat" }, false);
		}
	}, options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);
	// a keepalive must never keep the process itself alive
	heartbeatTimer.unref?.();

	return {
		publish(event) {
			broadcast(event, true);
		},

		handle(context) {
			return streamSSE(context, async (stream) => {
				options.onConnect?.();

				// everything at or below this id has been delivered (or, for a
				// fresh connection, predates it) — the one guard that makes
				// replay and live delivery raceless under monotonic ids
				const replayFromId = parseLastEventId(
					context.req.header(LAST_EVENT_ID_HEADER),
				);
				let lastDeliveredId = replayFromId ?? nextEventId - 1;

				const write = async (event: StampedEvent): Promise<void> => {
					if (event.id <= lastDeliveredId) {
						return;
					}
					lastDeliveredId = event.id;
					await stream.writeSSE({
						id: String(event.id),
						data: event.payload,
					});
				};

				// events published while the replay loop is mid-write must wait
				// their turn: writing them immediately would advance
				// lastDeliveredId past ring entries not yet replayed
				let replaying = true;
				const backlog: StampedEvent[] = [];
				const deliver = (event: StampedEvent): void => {
					if (replaying) {
						backlog.push(event);
						return;
					}
					void write(event);
				};
				connections.add(deliver);

				let releaseStream = (): void => {};
				const streamClosed = new Promise<void>((resolve) => {
					releaseStream = resolve;
				});
				stream.onAbort(() => {
					connections.delete(deliver);
					options.onDisconnect?.();
					releaseStream();
				});

				for (const buffered of [...ring]) {
					await write(buffered);
				}
				replaying = false;
				for (const queued of backlog) {
					await write(queued);
				}

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

function parseLastEventId(header: string | undefined): number | null {
	if (header === undefined) {
		return null;
	}
	const id = Number(header);
	return Number.isInteger(id) && id >= 0 ? id : null;
}
