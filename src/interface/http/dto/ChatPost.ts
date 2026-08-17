import { z } from "zod";
import { chatMessageContextDtoSchema } from "./ChatMessageDto";

/**
 * `POST /api/chat/messages` (ARCHITECTURE §8): the question plus what the user
 * is looking at. The context is supplied by the client — that is how F8 stays
 * context-aware without the server tracking the viewport — and defaults to
 * nothing so a question asked from no particular place is still valid.
 *
 * The text reaches the agent as stdin bytes, never as an argv member (SEC-004).
 */
export const chatPostSchema = z.object({
	text: z.string().min(1),
	context: chatMessageContextDtoSchema.default({}),
});

export type ChatPost = z.infer<typeof chatPostSchema>;

/** 202 from `POST /api/chat/messages`: the reply streams over SSE (§8) */
export const chatTurnAcceptedDtoSchema = z.object({ turnId: z.string() });

export type ChatTurnAcceptedDto = z.infer<typeof chatTurnAcceptedDtoSchema>;
