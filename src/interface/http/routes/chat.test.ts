import { describe, expect, it } from "vitest";
import {
	type AnalysisApp,
	CHAT_REPLY,
	createAnalysisApp,
	waitFor,
} from "../../../../test/helpers/createAnalysisApp";
import { createTestApp } from "../../../../test/helpers/createTestApp";
import { chatMessageDtoSchema } from "../dto/ChatMessageDto";

function postMessage(app: AnalysisApp, body: unknown) {
	return app.app.request("/api/chat/messages", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function messages(app: AnalysisApp) {
	const response = await app.app.request("/api/chat/messages");
	expect(response.status).toBe(200);
	return chatMessageDtoSchema.array().parse(await response.json());
}

describe("GET /api/chat/messages", () => {
	it("is empty before anything was asked", async () => {
		const app = await createAnalysisApp();
		expect(await messages(app)).toEqual([]);
	});
});

describe("POST /api/chat/messages", () => {
	it("accepts the question with 202 and answers over SSE, not here", async () => {
		const app = await createAnalysisApp();
		const response = await postMessage(app, {
			text: "why does the greeting change?",
			context: { file: "src/greeting.ts" },
		});

		expect(response.status).toBe(202);
		const { turnId } = (await response.json()) as { turnId: string };
		expect(turnId).not.toBe("");

		await waitFor(app, () =>
			app.events.some((event) => event.type === "chat.turn.completed"),
		);
		const history = await messages(app);
		expect(history.map((message) => message.role)).toEqual([
			"user",
			"assistant",
		]);
		expect(history[0].text).toBe("why does the greeting change?");
		expect(history[0].context).toEqual({ file: "src/greeting.ts" });
		expect(history[1].text).toBe(CHAT_REPLY);
	});

	it("keeps the question in the history when the turn fails", async () => {
		const app = await createAnalysisApp();
		app.engine.options = {
			chat: {
				events: [
					{
						type: "result",
						ok: false,
						reason: "crashed",
						terminalReason: "api_error",
						stderrTail: "",
					},
				],
			},
		};
		await postMessage(app, { text: "what broke?" });

		await waitFor(app, () =>
			app.events.some((event) => event.type === "chat.turn.failed"),
		);
		const history = await messages(app);
		expect(history.map((message) => message.role)).toEqual(["user"]);
	});

	it("accepts a question asked from no particular place", async () => {
		const app = await createAnalysisApp();
		const response = await postMessage(app, { text: "what is this change?" });

		expect(response.status).toBe(202);
		const history = await messages(app);
		expect(history[0].context).toBeUndefined();
	});

	it("400s an empty question", async () => {
		const app = await createAnalysisApp();
		const response = await postMessage(app, { text: "" });

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ reason: "validation" });
	});

	it("400s a body that is not a chat post at all", async () => {
		const app = await createAnalysisApp();
		const response = await postMessage(app, { question: "wrong field" });

		expect(response.status).toBe(400);
	});

	it("503s with agent-missing when no agent CLI was found (REQ-004)", async () => {
		const { app } = await createTestApp();
		const response = await app.request("/api/chat/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "anyone there?" }),
		});

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ reason: "agent-missing" });
	});
});
