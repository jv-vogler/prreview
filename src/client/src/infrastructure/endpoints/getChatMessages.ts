import type { ChatMessageDto } from "@dto/ChatMessageDto";
import { chatMessageDtoSchema } from "@dto/ChatMessageDto";
import { z } from "zod";
import { parseLogged } from "../endpoints-helpers/parseLogged";
import type { ApiClient } from "../httpClients/apiClient";

const responseSchema = z.array(chatMessageDtoSchema);

/** The stored thread. Replies still in flight arrive over SSE, not here. */
export async function getChatMessages(
	api: ApiClient,
): Promise<ChatMessageDto[]> {
	const data = await api.get("/api/chat/messages");
	return parseLogged(responseSchema, data, "GET /api/chat/messages");
}
