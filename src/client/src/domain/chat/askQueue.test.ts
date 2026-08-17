import { describe, expect, it } from "vitest";
import { type Ask, nextSendableAsk, noAsks, reduceAsks } from "./askQueue";
import { initialChatState, reduceChatDelta } from "./reduceChatDelta";

function ask(key: string, text = `question ${key}`) {
	return { type: "asked" as const, key, text, context: {} };
}

const streamingTurn = reduceChatDelta(initialChatState, {
	type: "chat.turn.delta",
	turnId: "turn-1",
	text: "Because ",
});

const settledTurn = reduceChatDelta(streamingTurn, {
	type: "chat.turn.completed",
	turnId: "turn-1",
	message: {
		role: "assistant",
		text: "Because config.",
		at: "2026-08-17T10:00:00.000Z",
	},
});

describe("reduceAsks", () => {
	it("records a question as queued, in the order it was asked", () => {
		const asks = reduceAsks(reduceAsks(noAsks, ask("a")), ask("b"));
		expect(asks.map((entry: Ask) => [entry.key, entry.status])).toEqual([
			["a", "queued"],
			["b", "queued"],
		]);
	});

	it("walks one question through sending and sent without touching the others", () => {
		let asks = reduceAsks(reduceAsks(noAsks, ask("a")), ask("b"));
		asks = reduceAsks(asks, { type: "sending", key: "a" });
		expect(asks[0]?.status).toBe("sending");
		asks = reduceAsks(asks, { type: "sent", key: "a", turnId: "turn-1" });
		expect(asks[0]).toMatchObject({ status: "sent", turnId: "turn-1" });
		expect(asks[1]?.status).toBe("queued");
	});

	it("keeps the question when the post itself was refused", () => {
		let asks = reduceAsks(noAsks, ask("a", "why is this safe?"));
		asks = reduceAsks(asks, {
			type: "refused",
			key: "a",
			reason: "agent-missing",
			message: "no agent",
		});
		expect(asks[0]).toMatchObject({
			text: "why is this safe?",
			status: "refused",
			refusal: { reason: "agent-missing" },
		});
	});

	it("ignores an action for a question it does not know", () => {
		const asks = reduceAsks(noAsks, ask("a"));
		expect(reduceAsks(asks, { type: "sending", key: "gone" })).toEqual(asks);
	});
});

describe("nextSendableAsk", () => {
	it("offers the first queued question when nothing is in flight", () => {
		const asks = reduceAsks(reduceAsks(noAsks, ask("a")), ask("b"));
		expect(nextSendableAsk(asks, initialChatState)?.key).toBe("a");
	});

	it("holds the queue while a post is in flight", () => {
		let asks = reduceAsks(reduceAsks(noAsks, ask("a")), ask("b"));
		asks = reduceAsks(asks, { type: "sending", key: "a" });
		expect(nextSendableAsk(asks, initialChatState)).toBeNull();
	});

	it("holds the queue while the reply is still streaming", () => {
		let asks = reduceAsks(reduceAsks(noAsks, ask("a")), ask("b"));
		asks = reduceAsks(asks, { type: "sent", key: "a", turnId: "turn-1" });
		expect(nextSendableAsk(asks, streamingTurn)).toBeNull();
	});

	it("holds the queue while a posted question has seen no frame at all", () => {
		let asks = reduceAsks(reduceAsks(noAsks, ask("a")), ask("b"));
		asks = reduceAsks(asks, { type: "sent", key: "a", turnId: "turn-1" });
		expect(nextSendableAsk(asks, initialChatState)).toBeNull();
	});

	it("releases the next question once the reply settles", () => {
		let asks = reduceAsks(reduceAsks(noAsks, ask("a")), ask("b"));
		asks = reduceAsks(asks, { type: "sent", key: "a", turnId: "turn-1" });
		expect(nextSendableAsk(asks, settledTurn)?.key).toBe("b");
	});

	it("does not wait on a question the server refused", () => {
		let asks = reduceAsks(reduceAsks(noAsks, ask("a")), ask("b"));
		asks = reduceAsks(asks, {
			type: "refused",
			key: "a",
			reason: "agent-missing",
			message: "no agent",
		});
		expect(nextSendableAsk(asks, initialChatState)?.key).toBe("b");
	});
});
