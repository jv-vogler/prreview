import type { ChatMessageDto } from "@dto/ChatMessageDto";
import { describe, expect, it } from "vitest";
import { noAsks, reduceAsks } from "./askQueue";
import { composeTranscript } from "./composeTranscript";
import { initialChatState, reduceChatDelta } from "./reduceChatDelta";

const STORED: ChatMessageDto[] = [
	{
		role: "user",
		text: "why the rename?",
		context: { file: "src/greeting.ts" },
		at: "2026-08-17T09:00:00.000Z",
	},
	{
		role: "assistant",
		text: "Because the caller moved.",
		at: "2026-08-17T09:00:04.000Z",
	},
];

function asked(text = "who calls this?") {
	return reduceAsks(noAsks, {
		type: "asked",
		key: "a1",
		text,
		context: { file: "src/greeting.ts", hunkId: "h1" },
	});
}

function sent(turnId = "turn-1") {
	return reduceAsks(asked(), { type: "sent", key: "a1", turnId });
}

describe("composeTranscript", () => {
	it("renders the stored thread as questions and answers, in order", () => {
		expect(composeTranscript(STORED, noAsks, initialChatState)).toEqual([
			{
				kind: "question",
				key: "stored-0",
				text: "why the rename?",
				context: { file: "src/greeting.ts" },
			},
			{
				kind: "answer",
				key: "stored-1",
				state: { status: "answered", text: "Because the caller moved." },
			},
		]);
	});

	it("puts this visit's questions after the stored prologue", () => {
		const entries = composeTranscript(STORED, asked(), initialChatState);
		expect(entries.map((entry) => entry.key)).toEqual([
			"stored-0",
			"stored-1",
			"ask-a1",
			"reply-a1",
		]);
	});

	it("shows a queued question as waiting for its turn", () => {
		const [, reply] = composeTranscript([], asked(), initialChatState);
		expect(reply).toEqual({
			kind: "answer",
			key: "reply-a1",
			state: { status: "queued" },
		});
	});

	it("shows a posted question with no words yet as waiting", () => {
		const [, reply] = composeTranscript([], sent(), initialChatState);
		expect(reply?.kind === "answer" && reply.state.status).toBe("waiting");
	});

	it("streams the accumulated text, then replaces it with the stored message", () => {
		const streaming = reduceChatDelta(initialChatState, {
			type: "chat.turn.delta",
			turnId: "turn-1",
			text: "The caller ",
		});
		const [, mid] = composeTranscript([], sent(), streaming);
		expect(mid?.kind === "answer" && mid.state).toEqual({
			status: "streaming",
			text: "The caller ",
		});

		const settled = reduceChatDelta(streaming, {
			type: "chat.turn.completed",
			turnId: "turn-1",
			message: {
				role: "assistant",
				text: "The caller in main.ts.",
				at: "2026-08-17T10:00:00.000Z",
			},
		});
		const [, done] = composeTranscript([], sent(), settled);
		expect(done?.kind === "answer" && done.state).toEqual({
			status: "answered",
			text: "The caller in main.ts.",
		});
	});

	it("reports a failed turn and a refused post through the same state", () => {
		const failed = reduceChatDelta(initialChatState, {
			type: "chat.turn.failed",
			turnId: "turn-1",
			reason: "timed-out",
			message: "gave up",
		});
		const [, fromTurn] = composeTranscript([], sent(), failed);
		expect(fromTurn?.kind === "answer" && fromTurn.state).toEqual({
			status: "failed",
			reason: "timed-out",
		});

		const refused = reduceAsks(asked(), {
			type: "refused",
			key: "a1",
			reason: "agent-missing",
			message: "no agent",
		});
		const [, fromPost] = composeTranscript([], refused, initialChatState);
		expect(fromPost?.kind === "answer" && fromPost.state).toEqual({
			status: "failed",
			reason: "agent-missing",
		});
	});

	it("leaves out a live turn this page never asked for", () => {
		const elsewhere = reduceChatDelta(initialChatState, {
			type: "chat.turn.delta",
			turnId: "another-tab",
			text: "not ours",
		});
		expect(composeTranscript([], noAsks, elsewhere)).toEqual([]);
	});
});
