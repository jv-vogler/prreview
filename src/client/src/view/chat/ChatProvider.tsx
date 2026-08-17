import type {
	ChatMessageContextDto,
	ChatMessageDto,
} from "@dto/ChatMessageDto";
import type { RunFailureReasonDto } from "@dto/RunDto";
import { runFailureReasonDtoSchema } from "@dto/RunDto";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useReducer,
	useRef,
} from "react";
import type { Ask } from "../../domain/chat/askQueue";
import {
	nextSendableAsk,
	noAsks,
	reduceAsks,
} from "../../domain/chat/askQueue";
import type { TranscriptEntry } from "../../domain/chat/composeTranscript";
import { composeTranscript } from "../../domain/chat/composeTranscript";
import type { ChatTurnState } from "../../domain/chat/reduceChatDelta";
import {
	initialChatState,
	reduceChatDelta,
} from "../../domain/chat/reduceChatDelta";
import { getChatMessages } from "../../infrastructure/endpoints/getChatMessages";
import { postChatMessage } from "../../infrastructure/endpoints/postChatMessage";
import type { ServerEventType } from "../../infrastructure/events/eventSource";
import { HttpError } from "../../infrastructure/httpClients/HttpError";
import { useClientContainer } from "../app/ClientContainerProvider";
import { useFeatureFlags } from "../session/useFeatureFlags";

export const CHAT_MESSAGES_QUERY_KEY = ["chat", "messages"] as const;

const CHAT_EVENT_TYPES = [
	"chat.turn.started",
	"chat.turn.delta",
	"chat.turn.completed",
	"chat.turn.failed",
] as const satisfies readonly ServerEventType[];

const NO_MESSAGES: readonly ChatMessageDto[] = [];

export interface ChatAsk {
	text: string;
	context: ChatMessageContextDto;
}

export interface Chat {
	/** the thread as stored on disk, which survives a restart (F13) */
	messages: readonly ChatMessageDto[];
	/** the turns this page watched arrive, in the order they were asked */
	turns: readonly ChatTurnState[];
	/** the questions this page asked, on their way to the agent */
	asks: readonly Ask[];
	/** the stored thread and this visit's turns, as one list to render */
	transcript: readonly TranscriptEntry[];
	sending: boolean;
	ask(ask: ChatAsk): void;
}

const ChatContext = createContext<Chat | null>(null);

export interface ChatProviderProps {
	children: ReactNode;
}

/**
 * Owns the chat lane's client half: the stored thread, the questions this visit
 * asked, the turns still streaming, and the request that asks. A reply never
 * comes back through the request — the server answers 202 and the words arrive
 * as `chat.turn.delta` frames, which the domain's reducer folds into turn state.
 *
 * Deltas are deliberately absent from the server's replay buffer, so a
 * reconnecting page relies on the stored thread rather than on replay.
 *
 * A question asked while the previous reply is still streaming waits its turn
 * here rather than on the wire (`nextSendableAsk`): the server's chat lane would
 * take both at once, and two replies arriving together would make the transcript
 * lie about what answered what.
 */
export function ChatProvider({ children }: ChatProviderProps) {
	const { api, events } = useClientContainer();
	const flags = useFeatureFlags();
	const [state, dispatch] = useReducer(reduceChatDelta, initialChatState);
	const [asks, dispatchAsk] = useReducer(reduceAsks, noAsks);
	const nextAskKeyRef = useRef(0);

	useEffect(() => {
		const unsubscribes = CHAT_EVENT_TYPES.map((type) =>
			events.subscribe(type, dispatch),
		);
		return () => {
			for (const unsubscribe of unsubscribes) {
				unsubscribe();
			}
		};
	}, [events]);

	const thread = useQuery({
		queryKey: CHAT_MESSAGES_QUERY_KEY,
		queryFn: () => getChatMessages(api),
		enabled: flags.chat,
		staleTime: Infinity,
	});

	const send = useMutation({
		mutationFn: (ask: Ask) =>
			postChatMessage(api, { text: ask.text, context: ask.context }),
		onSuccess: (accepted, ask) =>
			dispatchAsk({ type: "sent", key: ask.key, turnId: accepted.turnId }),
		onError: (error, ask) =>
			dispatchAsk({ type: "refused", key: ask.key, ...refusalFor(error) }),
	});

	// the queue drains itself: one question is in flight at a time, and the next
	// goes out when the reply before it settles
	const post = send.mutate;
	useEffect(() => {
		const next = nextSendableAsk(asks, state);
		if (next === null) {
			return;
		}
		dispatchAsk({ type: "sending", key: next.key });
		post(next);
	}, [asks, state, post]);

	const value = useMemo<Chat>(() => {
		const messages = thread.data ?? NO_MESSAGES;
		return {
			messages,
			turns: state.order.map((turnId) => state.byTurnId[turnId]).filter(isTurn),
			asks,
			transcript: composeTranscript(messages, asks, state),
			sending: send.isPending,
			ask: (ask) =>
				dispatchAsk({
					type: "asked",
					key: String(nextAskKeyRef.current++),
					text: ask.text,
					context: ask.context,
				}),
		};
	}, [thread.data, state, asks, send.isPending]);

	return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): Chat {
	const chat = useContext(ChatContext);
	if (chat === null) {
		throw new Error("useChat must be used inside a ChatProvider");
	}
	return chat;
}

function isTurn(turn: ChatTurnState | undefined): turn is ChatTurnState {
	return turn !== undefined;
}

/**
 * A post that never reached a turn failed for one of the same reasons a run can
 * (503 `agent-missing` is the one a client can really see), so it is reported
 * through the same closed union the copy table maps exhaustively.
 */
function refusalFor(error: unknown): {
	reason: RunFailureReasonDto;
	message: string;
} {
	const message = error instanceof Error ? error.message : "the request failed";
	if (!(error instanceof HttpError)) {
		return { reason: "internal", message };
	}
	const reason = runFailureReasonDtoSchema.safeParse(error.reason);
	return { reason: reason.success ? reason.data : "internal", message };
}
