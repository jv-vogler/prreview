import type { ChatMessageContextDto } from "@dto/ChatMessageDto";
import type { RunFailureReasonDto } from "@dto/RunDto";
import type { ChatState } from "./reduceChatDelta";

/**
 * Where one question is on its way to the agent. `sent` is the end of this
 * machine's business: from there the reply's own state lives in `ChatState`,
 * folded from the SSE frames.
 */
export type AskStatus = "queued" | "sending" | "sent" | "refused";

export interface Ask {
	/**
	 * Client-side identity. A question exists (and is on screen) before the
	 * server has named its turn, so it cannot be keyed by `turnId`.
	 */
	key: string;
	text: string;
	context: ChatMessageContextDto;
	status: AskStatus;
	/** the server's turn id, once the post was accepted */
	turnId: string | null;
	/** why the post itself never landed — 503 `agent-missing` is the real case */
	refusal: { reason: RunFailureReasonDto; message: string } | null;
}

export type AskAction =
	| {
			type: "asked";
			key: string;
			text: string;
			context: ChatMessageContextDto;
	  }
	| { type: "sending"; key: string }
	| { type: "sent"; key: string; turnId: string }
	| {
			type: "refused";
			key: string;
			reason: RunFailureReasonDto;
			message: string;
	  };

export const noAsks: readonly Ask[] = [];

/** The questions this visit asked, in the order they were asked. */
export function reduceAsks(
	asks: readonly Ask[],
	action: AskAction,
): readonly Ask[] {
	if (action.type === "asked") {
		return [
			...asks,
			{
				key: action.key,
				text: action.text,
				context: action.context,
				status: "queued",
				turnId: null,
				refusal: null,
			},
		];
	}
	return asks.map((ask) =>
		ask.key === action.key ? advance(ask, action) : ask,
	);
}

function advance(ask: Ask, action: Exclude<AskAction, { type: "asked" }>): Ask {
	switch (action.type) {
		case "sending":
			return { ...ask, status: "sending" };
		case "sent":
			return { ...ask, status: "sent", turnId: action.turnId };
		case "refused":
			return {
				...ask,
				status: "refused",
				refusal: { reason: action.reason, message: action.message },
			};
	}
}

/**
 * The next question to post, or `null` while one is still being answered.
 *
 * The server's chat lane is a plain FIFO and would happily accept a second
 * question mid-reply, but then two replies would stream into the dock at once
 * and the transcript would stop being a transcript. So the client holds the
 * next question back until the one before it has settled — the UI never claims
 * an order the reader did not see.
 */
export function nextSendableAsk(
	asks: readonly Ask[],
	chat: ChatState,
): Ask | null {
	const busy = asks.some(
		(ask) =>
			ask.status === "sending" ||
			(ask.status === "sent" && awaitsReply(ask, chat)),
	);
	if (busy) {
		return null;
	}
	return asks.find((ask) => ask.status === "queued") ?? null;
}

/**
 * A posted question is still being answered until its turn has settled. A turn
 * we have not seen a single frame of counts as unsettled: the `started` frame
 * may simply not have arrived yet, and posting the next question in that gap is
 * exactly the race this queue exists to avoid.
 */
function awaitsReply(ask: Ask, chat: ChatState): boolean {
	if (ask.turnId === null) {
		return true;
	}
	const turn = chat.byTurnId[ask.turnId];
	return turn === undefined || turn.status === "streaming";
}
