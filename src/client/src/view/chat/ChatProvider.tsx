import type {
	ChatMessageContextDto,
	ChatMessageDto,
} from "@dto/ChatMessageDto";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useReducer,
} from "react";
import type { ChatTurnState } from "../../domain/chat/reduceChatDelta";
import {
	initialChatState,
	reduceChatDelta,
} from "../../domain/chat/reduceChatDelta";
import { getChatMessages } from "../../infrastructure/endpoints/getChatMessages";
import { postChatMessage } from "../../infrastructure/endpoints/postChatMessage";
import type { ServerEventType } from "../../infrastructure/events/eventSource";
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
	sending: boolean;
	ask(ask: ChatAsk): void;
}

const ChatContext = createContext<Chat | null>(null);

export interface ChatProviderProps {
	children: ReactNode;
}

/**
 * Owns the chat lane's client half: the stored thread, the turns still
 * streaming, and the request that asks a question. A reply never comes back
 * through the request — the server answers 202 and the words arrive as
 * `chat.turn.delta` frames, which the domain's reducer folds into turn state.
 *
 * Deltas are deliberately absent from the server's replay buffer, so a
 * reconnecting page relies on the stored thread rather than on replay.
 */
export function ChatProvider({ children }: ChatProviderProps) {
	const { api, events } = useClientContainer();
	const flags = useFeatureFlags();
	const [state, dispatch] = useReducer(reduceChatDelta, initialChatState);

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
		mutationFn: (ask: ChatAsk) => postChatMessage(api, ask),
	});

	const value = useMemo<Chat>(
		() => ({
			messages: thread.data ?? NO_MESSAGES,
			turns: state.order.map((turnId) => state.byTurnId[turnId]).filter(isTurn),
			sending: send.isPending,
			ask: (ask) => send.mutate(ask),
		}),
		[thread.data, state, send],
	);

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
