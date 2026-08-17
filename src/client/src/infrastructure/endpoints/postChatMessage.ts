import type { ChatPost, ChatTurnAcceptedDto } from "@dto/ChatPost";
import { chatTurnAcceptedDtoSchema } from "@dto/ChatPost";
import { parseLogged } from "../endpoints-helpers/parseLogged";
import type { ApiClient } from "../httpClients/apiClient";

/**
 * Asks the question and returns the turn's id. The answer never comes back
 * through here: it streams as `chat.turn.delta` frames and settles as
 * `chat.turn.completed` on the SSE channel.
 */
export async function postChatMessage(
	api: ApiClient,
	post: ChatPost,
): Promise<ChatTurnAcceptedDto> {
	const data = await api.post("/api/chat/messages", post);
	return parseLogged(
		chatTurnAcceptedDtoSchema,
		data,
		"POST /api/chat/messages",
	);
}
