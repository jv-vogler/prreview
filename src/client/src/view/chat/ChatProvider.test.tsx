// @vitest-environment jsdom
import type { ServerEvent } from "@dto/ServerEvent";
import type { SessionDto } from "@dto/SessionDto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientContainer } from "../../infrastructure/container";
import type {
	ServerEventHandler,
	ServerEvents,
	ServerEventType,
} from "../../infrastructure/events/eventSource";
import { ClientContainerProvider } from "../app/ClientContainerProvider";
import { ChatProvider, useChat } from "./ChatProvider";

afterEach(cleanup);

interface FakeServerEvents extends ServerEvents {
	emit(event: ServerEvent): void;
}

function createFakeServerEvents(): FakeServerEvents {
	const handlers = new Map<string, Set<(event: ServerEvent) => void>>();
	return {
		subscribe<Type extends ServerEventType>(
			type: Type,
			handler: ServerEventHandler<Type>,
		) {
			let set = handlers.get(type);
			if (set === undefined) {
				set = new Set();
				handlers.set(type, set);
			}
			set.add(handler as (event: ServerEvent) => void);
			return () => set.delete(handler as (event: ServerEvent) => void);
		},
		emit(event) {
			for (const handler of handlers.get(event.type) ?? []) {
				handler(event);
			}
		},
		close() {
			handlers.clear();
		},
	};
}

function session(agentKind: "claude" | "none"): SessionDto {
	return {
		changesetId: "worktree",
		source: { kind: "worktree" },
		roundId: "r1",
		resumed: false,
		toolchain: {
			agent:
				agentKind === "claude"
					? { kind: "claude", version: "2.1.233" }
					: { kind: "none" },
			github: { kind: "none" },
		},
		announce: { resolved: "working tree", overrideHint: "" },
		coverage: { total: 0, byFile: {} },
		analysis: {
			understandingAvailable: false,
			findingsAvailable: false,
			annotationCount: 0,
		},
	};
}

function Harness() {
	const chat = useChat();
	return (
		<div>
			<p data-testid="stored">{chat.messages.map((m) => m.text).join("|")}</p>
			<p data-testid="turns">
				{chat.turns.map((turn) => `${turn.status}:${turn.text}`).join("|")}
			</p>
			<button
				type="button"
				onClick={() => chat.ask({ text: "why the rename?", context: {} })}
			>
				ask
			</button>
		</div>
	);
}

function renderHarness(agentKind: "claude" | "none") {
	const events = createFakeServerEvents();
	const get = vi.fn(async (path: string) => {
		if (path === "/api/session") {
			return session(agentKind);
		}
		if (path === "/api/chat/messages") {
			return [
				{ role: "user", text: "asked before", at: "2026-08-17T09:00:00.000Z" },
			];
		}
		throw new Error(`unexpected GET ${path}`);
	});
	const post = vi.fn().mockResolvedValue({ turnId: "turn-1" });
	const container: ClientContainer = {
		api: { get, put: vi.fn().mockRejectedValue(new Error("not used")), post },
		events,
	};
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={queryClient}>
			<ClientContainerProvider container={container}>
				<Suspense fallback={<p>loading</p>}>
					<ChatProvider>
						<Harness />
					</ChatProvider>
				</Suspense>
			</ClientContainerProvider>
		</QueryClientProvider>,
	);
	return { events, get, post };
}

describe("ChatProvider with an agent", () => {
	it("loads the stored thread", async () => {
		const { get } = renderHarness("claude");
		await waitFor(() => {
			expect(screen.getByTestId("stored").textContent).toBe("asked before");
		});
		expect(
			get.mock.calls.filter(([path]) => path === "/api/chat/messages"),
		).toHaveLength(1);
	});

	it("streams a reply through the reducer and settles it", async () => {
		const { events } = renderHarness("claude");
		await screen.findByTestId("turns");

		act(() => {
			events.emit({ type: "chat.turn.started", turnId: "turn-1" });
			events.emit({
				type: "chat.turn.delta",
				turnId: "turn-1",
				text: "Because ",
			});
			events.emit({
				type: "chat.turn.delta",
				turnId: "turn-1",
				text: "config.",
			});
		});
		expect(screen.getByTestId("turns").textContent).toBe(
			"streaming:Because config.",
		);

		act(() => {
			events.emit({
				type: "chat.turn.completed",
				turnId: "turn-1",
				message: {
					role: "assistant",
					text: "Because config.",
					at: "2026-08-17T10:00:05.000Z",
				},
			});
		});
		expect(screen.getByTestId("turns").textContent).toBe(
			"completed:Because config.",
		);
	});

	it("posts a question and never waits for the answer", async () => {
		const { post } = renderHarness("claude");
		const button = await screen.findByRole("button", { name: "ask" });

		act(() => {
			button.click();
		});

		await waitFor(() => {
			expect(post).toHaveBeenCalledWith("/api/chat/messages", {
				text: "why the rename?",
				context: {},
			});
		});
	});
});

describe("ChatProvider without an agent", () => {
	it("never asks for a thread that cannot exist", async () => {
		const { get } = renderHarness("none");
		await waitFor(() => {
			expect(screen.getByTestId("stored").textContent).toBe("");
		});
		expect(
			get.mock.calls.filter(([path]) => path === "/api/chat/messages"),
		).toHaveLength(0);
	});
});
