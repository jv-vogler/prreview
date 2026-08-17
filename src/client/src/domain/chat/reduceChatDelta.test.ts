import type { ChatMessageDto } from "@dto/ChatMessageDto";
import { describe, expect, it } from "vitest";
import type { ChatEvent, ChatState } from "./reduceChatDelta";
import { initialChatState, reduceChatDelta } from "./reduceChatDelta";

const TURN = "turn-1";

function fold(
	events: readonly ChatEvent[],
	from: ChatState = initialChatState,
) {
	return events.reduce(reduceChatDelta, from);
}

function storedReply(text: string): ChatMessageDto {
	return { role: "assistant", text, at: "2026-08-17T10:00:05.000Z" };
}

describe("reduceChatDelta", () => {
	it("accumulates a reply token by token and settles on the stored message", () => {
		const state = fold([
			{ type: "chat.turn.started", turnId: TURN },
			{ type: "chat.turn.delta", turnId: TURN, text: "It " },
			{ type: "chat.turn.delta", turnId: TURN, text: "renames " },
			{ type: "chat.turn.delta", turnId: TURN, text: "the port." },
			{
				type: "chat.turn.completed",
				turnId: TURN,
				message: storedReply("It renames the port."),
			},
		]);

		const turn = state.byTurnId[TURN];
		expect(turn?.status).toBe("completed");
		expect(turn?.text).toBe("It renames the port.");
		expect(turn?.message?.role).toBe("assistant");
		expect(state.order).toEqual([TURN]);
	});

	it("creates the turn when a delta beats its started frame", () => {
		const state = fold([
			{ type: "chat.turn.delta", turnId: TURN, text: "early" },
			{ type: "chat.turn.started", turnId: TURN },
		]);

		expect(state.byTurnId[TURN]?.text).toBe("early");
		expect(state.byTurnId[TURN]?.status).toBe("streaming");
		expect(state.order).toEqual([TURN]);
	});

	it("appends repeated identical deltas, because tokens do repeat", () => {
		const state = fold([
			{ type: "chat.turn.delta", turnId: TURN, text: "so " },
			{ type: "chat.turn.delta", turnId: TURN, text: "so " },
		]);
		expect(state.byTurnId[TURN]?.text).toBe("so so ");
	});

	it("drops a delta that arrives after the turn completed", () => {
		const completed = fold([
			{ type: "chat.turn.delta", turnId: TURN, text: "done" },
			{
				type: "chat.turn.completed",
				turnId: TURN,
				message: storedReply("done"),
			},
		]);
		const late = fold(
			[{ type: "chat.turn.delta", turnId: TURN, text: " and more" }],
			completed,
		);

		expect(late).toBe(completed);
		expect(late.byTurnId[TURN]?.text).toBe("done");
	});

	it("marks a failed turn with its reason and keeps what streamed", () => {
		const state = fold([
			{ type: "chat.turn.delta", turnId: TURN, text: "half an " },
			{
				type: "chat.turn.failed",
				turnId: TURN,
				reason: "timed-out",
				message: "The agent did not answer in time.",
			},
		]);

		const turn = state.byTurnId[TURN];
		expect(turn?.status).toBe("failed");
		expect(turn?.text).toBe("half an ");
		expect(turn?.error).toEqual({
			reason: "timed-out",
			message: "The agent did not answer in time.",
		});
	});

	it("never reopens a failed turn", () => {
		const failed = fold([
			{
				type: "chat.turn.failed",
				turnId: TURN,
				reason: "crashed",
				message: "gone",
			},
		]);
		expect(
			fold([{ type: "chat.turn.delta", turnId: TURN, text: "x" }], failed),
		).toBe(failed);
	});

	it("keeps two turns apart and in the order they were asked", () => {
		const state = fold([
			{ type: "chat.turn.started", turnId: "turn-1" },
			{ type: "chat.turn.delta", turnId: "turn-1", text: "first" },
			{ type: "chat.turn.started", turnId: "turn-2" },
			{ type: "chat.turn.delta", turnId: "turn-2", text: "second" },
		]);

		expect(state.order).toEqual(["turn-1", "turn-2"]);
		expect(state.byTurnId["turn-1"]?.text).toBe("first");
		expect(state.byTurnId["turn-2"]?.text).toBe("second");
	});
});
