import type { ServerEvent } from "@dto/ServerEvent";
import { serverEventSchema } from "@dto/ServerEvent";

export type ServerEventType = ServerEvent["type"];

export type ServerEventHandler<Type extends ServerEventType> = (
	event: Extract<ServerEvent, { type: Type }>,
) => void;

export interface ServerEvents {
	subscribe<Type extends ServerEventType>(
		type: Type,
		handler: ServerEventHandler<Type>,
	): () => void;
	close(): void;
}

const EVENTS_URL = "/api/events";

/**
 * The single SSE channel (ARCHITECTURE §8). The native EventSource owns
 * reconnection and carries `Last-Event-ID` on reconnect by itself — the
 * server's ring buffer replays what was missed, so this module only parses
 * and dispatches; it decides nothing (ARCHITECTURE §9).
 *
 * Events are validated on the log-don't-block policy (CON-004): an event that
 * fails the schema is logged and still dispatched by its `type` field, so an
 * additive server change never silently mutes a subscriber.
 */
export function createServerEvents(url: string = EVENTS_URL): ServerEvents {
	const handlersByType = new Map<string, Set<(event: never) => void>>();
	const source = new EventSource(url);

	source.onmessage = (message: MessageEvent<string>) => {
		const event = parseServerEvent(message.data);
		if (event === null) {
			return;
		}
		const handlers = handlersByType.get(event.type);
		if (handlers === undefined) {
			return;
		}
		for (const handler of handlers) {
			(handler as (dispatched: ServerEvent) => void)(event);
		}
	};

	return {
		subscribe(type, handler) {
			let handlers = handlersByType.get(type);
			if (handlers === undefined) {
				handlers = new Set();
				handlersByType.set(type, handlers);
			}
			handlers.add(handler as (event: never) => void);
			return () => {
				handlers.delete(handler as (event: never) => void);
			};
		},
		close() {
			source.close();
			handlersByType.clear();
		},
	};
}

function parseServerEvent(data: string): ServerEvent | null {
	let raw: unknown;
	try {
		raw = JSON.parse(data);
	} catch (error) {
		console.error("prreview: unparseable SSE event", error);
		return null;
	}
	const result = serverEventSchema.safeParse(raw);
	if (result.success) {
		return result.data;
	}
	console.error(
		"prreview: SSE event did not match the expected schema",
		result.error,
	);
	const hasTypeField =
		typeof raw === "object" &&
		raw !== null &&
		typeof (raw as { type?: unknown }).type === "string";
	return hasTypeField ? (raw as ServerEvent) : null;
}
