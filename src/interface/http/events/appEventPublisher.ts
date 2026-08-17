import type {
	AppEvent,
	PublishEvent,
} from "../../../application/ports/EventPublisher";
import type { ServerEvent } from "../dto/ServerEvent";
import type { ReviewState } from "../reviewState";
import { toAnnotationDto } from "../toAnnotationDto";
import { toRunDto } from "../toRunDto";
import type { SseHub } from "./sseHub";

/**
 * Token deltas are coalesced into one frame per turn per window. A fast reply
 * produces tens of frames instead of thousands, and the words still land while
 * the sentence is being written (ARCHITECTURE §8, RISK-008).
 */
const DELTA_COALESCE_MS = 50;

export interface AppEventPublisherOptions {
	/** test seam; defaults to 50ms */
	coalesceMs?: number;
}

export interface PublisherTarget {
	hub: SseHub;
	state: ReviewState;
}

export interface AppEventPublisher {
	/** handed to buildContainer as the container's publish sink */
	publish: PublishEvent;
	/** wired once the hub and the review state exist */
	connect(target: PublisherTarget): void;
	/** flushes pending deltas and clears the coalesce timer */
	stop(): void;
}

/**
 * The bridge between what the application announces and what the browser sees
 * (ARCHITECTURE §8). In plain terms: use-cases say "this run started", "here is
 * an explanation", "here is the next word of the answer", and this turns each
 * into a frame on the one SSE channel.
 *
 * It also drops the server's own caches for whatever an event changed, so the
 * next request re-reads it: an annotation arriving in the background must be in
 * `GET /api/annotations` immediately, and a run that just succeeded must make
 * its intent map fetchable.
 *
 * It is created before the container because the container needs its `publish`,
 * and connected after the hub exists. Events published before connecting are
 * dropped — nothing can run before the server is listening, since analysis and
 * chat are user-triggered (REQ-003).
 */
export function createAppEventPublisher(
	options: AppEventPublisherOptions = {},
): AppEventPublisher {
	const coalesceMs = options.coalesceMs ?? DELTA_COALESCE_MS;
	const pendingDeltas = new Map<string, string>();
	let target: PublisherTarget | null = null;
	let coalesceTimer: NodeJS.Timeout | null = null;

	function send(event: ServerEvent): void {
		target?.hub.publish(event);
	}

	function flushTurn(turnId: string): void {
		const text = pendingDeltas.get(turnId);
		if (text === undefined) {
			return;
		}
		pendingDeltas.delete(turnId);
		send({ type: "chat.turn.delta", turnId, text });
	}

	function flushAll(): void {
		coalesceTimer = null;
		for (const turnId of [...pendingDeltas.keys()]) {
			flushTurn(turnId);
		}
	}

	function queueDelta(turnId: string, text: string): void {
		pendingDeltas.set(turnId, (pendingDeltas.get(turnId) ?? "") + text);
		if (coalesceTimer !== null) {
			return;
		}
		coalesceTimer = setTimeout(flushAll, coalesceMs);
		// a chat reply in flight must never be the reason the process lives on
		coalesceTimer.unref?.();
	}

	return {
		publish(event: AppEvent) {
			switch (event.type) {
				case "chat.turn.delta":
					queueDelta(event.turnId, event.text);
					return;
				case "chat.turn.completed":
				case "chat.turn.failed":
					// whatever was buffered was said before this event: the client
					// must not see the words after the message they belong to
					flushTurn(event.turnId);
					break;
				default:
					break;
			}
			invalidate(event, target?.state);
			send(toServerEvent(event));
		},

		connect(next) {
			target = next;
		},

		stop() {
			if (coalesceTimer !== null) {
				clearTimeout(coalesceTimer);
			}
			flushAll();
		},
	};
}

/** the M2 half of §8's event list, one AppEvent to one ServerEvent */
function toServerEvent(
	event: Exclude<AppEvent, { type: "chat.turn.delta" }>,
): ServerEvent {
	switch (event.type) {
		case "annotation.upserted":
			return {
				type: "annotation.upserted",
				annotation: toAnnotationDto(event.annotation),
			};
		case "annotation.removed":
			return { type: "annotation.removed", id: event.id };
		case "chat.turn.started":
			return { type: "chat.turn.started", turnId: event.turnId };
		case "chat.turn.completed":
			return {
				type: "chat.turn.completed",
				turnId: event.turnId,
				message: event.message,
			};
		case "chat.turn.failed":
			return {
				type: "chat.turn.failed",
				turnId: event.turnId,
				reason: event.reason,
				message: event.message,
			};
		default:
			return { type: event.type, run: toRunDto(event.run) };
	}
}

/**
 * Everything a background run changed on disk that a route serves from memory.
 * Dropping the cache rather than filling it keeps this synchronous: the next
 * request reads the store, so there is no window where the wire is ahead of what
 * `GET /api/annotations` would answer.
 */
function invalidate(event: AppEvent, state: ReviewState | undefined): void {
	if (state === undefined) {
		return;
	}
	if (
		event.type === "annotation.upserted" ||
		event.type === "annotation.removed"
	) {
		state.applyAnnotations(null);
		return;
	}
	if (event.type === "run.succeeded" && event.run.lane === "analysis") {
		state.applyAnalysis(null);
	}
}
