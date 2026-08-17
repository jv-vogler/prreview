import { z } from "zod";

/** what the user was looking at when they asked (ARCHITECTURE §7's frame) */
export const chatMessageContextDtoSchema = z.object({
	file: z.string().optional(),
	hunkId: z.string().optional(),
	annotationId: z.string().optional(),
});

export type ChatMessageContextDto = z.infer<typeof chatMessageContextDtoSchema>;

/**
 * One stored turn of the thread, served by `GET /api/chat/messages` and
 * carried by `chat.turn.completed`. Text is plain text and is rendered as
 * plain text — no HTML, no markdown (SEC-004).
 */
export const chatMessageDtoSchema = z.object({
	role: z.enum(["user", "assistant"]),
	text: z.string(),
	context: chatMessageContextDtoSchema.optional(),
	at: z.string(),
});

export type ChatMessageDto = z.infer<typeof chatMessageDtoSchema>;
