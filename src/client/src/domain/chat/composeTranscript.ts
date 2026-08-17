import type {
	ChatMessageContextDto,
	ChatMessageDto,
} from "@dto/ChatMessageDto";
import type { RunFailureReasonDto } from "@dto/RunDto";
import type { Ask } from "./askQueue";
import type { ChatState } from "./reduceChatDelta";

/** how far along the reply to one question is, in the terms the dock renders */
export type AnswerState =
	| { status: "queued" }
	| { status: "waiting" }
	| { status: "streaming"; text: string }
	| { status: "answered"; text: string }
	| { status: "failed"; reason: RunFailureReasonDto };

export type TranscriptEntry =
	| {
			kind: "question";
			key: string;
			text: string;
			context: ChatMessageContextDto;
	  }
	| { kind: "answer"; key: string; state: AnswerState };

/**
 * The thread the dock renders, from the two places a chat message can live.
 *
 * How those two compose was the open question Phase 7 left: the stored thread
 * (`GET /api/chat/messages`) already contains every turn the server has
 * finished, and the live turns contain the ones this page watched arrive — so
 * rendering both naively would show the last reply twice.
 *
 * The rule: **the stored thread is the prologue, the live turns are this
 * visit.** The thread is fetched once and never refetched while the page lives
 * (nothing invalidates its query), so it holds exactly what was said *before*
 * this page opened, and the two sets cannot overlap. After a reload the roles
 * swap by themselves — everything is stored, nothing is live — which is why
 * history survives a refresh without any merging.
 *
 * A live turn nobody here asked for (another tab's question) is left out: an
 * answer with no question above it would read as a reply to the last thing the
 * reader said, which it is not.
 */
export function composeTranscript(
	messages: readonly ChatMessageDto[],
	asks: readonly Ask[],
	chat: ChatState,
): readonly TranscriptEntry[] {
	const stored = messages.map<TranscriptEntry>((message, index) =>
		message.role === "user"
			? {
					kind: "question",
					key: `stored-${index}`,
					text: message.text,
					context: message.context ?? {},
				}
			: {
					kind: "answer",
					key: `stored-${index}`,
					state: { status: "answered", text: message.text },
				},
	);

	const live = asks.flatMap<TranscriptEntry>((ask) => [
		{
			kind: "question",
			key: `ask-${ask.key}`,
			text: ask.text,
			context: ask.context,
		},
		{ kind: "answer", key: `reply-${ask.key}`, state: answerFor(ask, chat) },
	]);

	return [...stored, ...live];
}

function answerFor(ask: Ask, chat: ChatState): AnswerState {
	if (ask.status === "refused") {
		return { status: "failed", reason: ask.refusal?.reason ?? "internal" };
	}
	if (ask.status === "queued") {
		return { status: "queued" };
	}
	const turn = ask.turnId === null ? undefined : chat.byTurnId[ask.turnId];
	if (turn === undefined) {
		return { status: "waiting" };
	}
	if (turn.status === "failed") {
		return { status: "failed", reason: turn.error?.reason ?? "internal" };
	}
	if (turn.status === "completed") {
		return { status: "answered", text: turn.message?.text ?? turn.text };
	}
	return turn.text === ""
		? { status: "waiting" }
		: { status: "streaming", text: turn.text };
}
