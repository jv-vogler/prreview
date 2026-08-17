import { ulid } from "ulid";

/**
 * A chat turn's id: what token deltas, the completed message, and a failure all
 * key on over SSE (§8). A ulid rather than a counter because the id travels to
 * the browser and a reconnect must never make two turns share one.
 */
export function newChatTurnId(): string {
	return ulid();
}
