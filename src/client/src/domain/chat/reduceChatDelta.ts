import type { ChatMessageDto } from "@dto/ChatMessageDto";
import type { RunFailureReasonDto } from "@dto/RunDto";
import type { ServerEvent } from "@dto/ServerEvent";

/** the four `chat.turn.*` frames of the SSE channel (ARCHITECTURE §8) */
export type ChatEvent = Extract<ServerEvent, { turnId: string }>;

export type ChatTurnStatus = "streaming" | "completed" | "failed";

/**
 * One reply as the client watched it arrive. `text` is what has been streamed
 * so far; once the turn completes, `message` is the authoritative stored turn
 * and is what gets rendered — the accumulated text is only what fills the gap
 * while the agent is still talking.
 */
export interface ChatTurnState {
	turnId: string;
	status: ChatTurnStatus;
	text: string;
	message: ChatMessageDto | null;
	error: { reason: RunFailureReasonDto; message: string } | null;
}

export interface ChatState {
	byTurnId: Readonly<Record<string, ChatTurnState>>;
	/** arrival order, so the dock can render turns as they were asked */
	order: readonly string[];
}

export const initialChatState: ChatState = { byTurnId: {}, order: [] };

/**
 * Folds one `chat.turn.*` event into the chat state.
 *
 * Deltas are not ring-buffered by the server, so the client can see them in
 * shapes a naive append would mishandle: a delta may arrive before the
 * `started` frame that announced its turn (it creates the turn), and one may
 * arrive after `completed` (it is dropped — the stored message already is the
 * whole answer). A settled turn is never reopened.
 */
export function reduceChatDelta(state: ChatState, event: ChatEvent): ChatState {
	const current = state.byTurnId[event.turnId];
	if (current !== undefined && current.status !== "streaming") {
		return state;
	}
	const turn = current ?? blankTurn(event.turnId);
	return put(state, applyEvent(turn, event));
}

function applyEvent(turn: ChatTurnState, event: ChatEvent): ChatTurnState {
	switch (event.type) {
		case "chat.turn.started":
			return turn;
		case "chat.turn.delta":
			return { ...turn, text: turn.text + event.text };
		case "chat.turn.completed":
			return {
				...turn,
				status: "completed",
				text: event.message.text,
				message: event.message,
			};
		case "chat.turn.failed":
			return {
				...turn,
				status: "failed",
				error: { reason: event.reason, message: event.message },
			};
	}
}

function blankTurn(turnId: string): ChatTurnState {
	return {
		turnId,
		status: "streaming",
		text: "",
		message: null,
		error: null,
	};
}

function put(state: ChatState, turn: ChatTurnState): ChatState {
	const known = state.order.includes(turn.turnId);
	return {
		byTurnId: { ...state.byTurnId, [turn.turnId]: turn },
		order: known ? state.order : [...state.order, turn.turnId],
	};
}
