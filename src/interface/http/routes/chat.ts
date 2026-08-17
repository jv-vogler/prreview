import { Hono } from "hono";
import { CHAT_THREAD_ID, type ChatTurn } from "../../../application/chatTurn";
import type { SessionStore } from "../../../application/ports/SessionStore";
import type { ChatMessageDto } from "../dto/ChatMessageDto";
import { type ChatTurnAcceptedDto, chatPostSchema } from "../dto/ChatPost";
import type { RunConflictDto } from "../dto/RunDto";
import type { ReviewState } from "../reviewState";
import { validatedJson } from "../validate";

const HTTP_ACCEPTED = 202;
const HTTP_CONFLICT = 409;

export interface ChatRouteDeps {
	state: ReviewState;
	store: SessionStore;
	chatTurn: ChatTurn;
}

/**
 * The chat lane on the wire (ARCHITECTURE §8, F8). `GET /api/chat/messages` is
 * the thread as stored; `POST /api/chat/messages` returns 202 with the turn's id
 * and never waits for the answer — the reply streams over SSE as
 * `chat.turn.delta` frames and settles as `chat.turn.completed`.
 *
 * The question's size is bounded by the existing 1MB body limit, and the text
 * reaches the agent as stdin bytes (SEC-004).
 */
export function chatRoute(deps: ChatRouteDeps): Hono {
	const route = new Hono();

	route.get("/messages", async (context) => {
		const review = deps.state.current();
		const thread = await deps.store.loadChatThread(
			review.manifest.changesetId,
			CHAT_THREAD_ID,
		);
		const messages: ChatMessageDto[] = thread?.messages ?? [];
		return context.json(messages);
	});

	route.post("/messages", async (context) => {
		const body = await validatedJson(context, chatPostSchema);
		const review = deps.state.current();
		const started = await deps.chatTurn({
			manifest: review.manifest,
			roundId: review.roundId,
			ref: review.ref,
			files: review.files,
			text: body.text,
			context: body.context,
		});

		// unreachable in M2: the chat lane is a plain FIFO, so a second question
		// queues behind the first rather than colliding with it
		if (started.run.kind === "conflict") {
			const conflict: RunConflictDto = {
				reason: "run-already-running",
				message: "A question is already being answered.",
				existingRunId: started.run.existingRunId,
			};
			return context.json(conflict, HTTP_CONFLICT);
		}
		const accepted: ChatTurnAcceptedDto = { turnId: started.turnId };
		return context.json(accepted, HTTP_ACCEPTED);
	});

	return route;
}
