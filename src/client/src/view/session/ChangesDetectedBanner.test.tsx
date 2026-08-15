// @vitest-environment jsdom
import type { ServerEvent } from "@dto/ServerEvent";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientContainer } from "../../infrastructure/container";
import type {
	ServerEventHandler,
	ServerEvents,
	ServerEventType,
} from "../../infrastructure/events/eventSource";
import { ClientContainerProvider } from "../app/ClientContainerProvider";
import { ChangesDetectedBanner } from "./ChangesDetectedBanner";
import { useDriftBanner } from "./useDriftBanner";

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

const refreshResponse = {
	changeset: {
		changesetId: "worktree",
		roundId: "r2",
		ref: {
			source: { kind: "worktree" },
			baseSha: "a".repeat(40),
			headSha: null,
			resolvedAt: "2026-08-15T00:00:00Z",
		},
		files: [],
	},
	coverage: { total: 100, byFile: {} },
};

function Harness() {
	const drift = useDriftBanner();
	if (!drift.driftDetected) {
		return <p>no drift</p>;
	}
	return (
		<ChangesDetectedBanner
			refreshing={drift.refreshing}
			onRefresh={drift.refresh}
		/>
	);
}

function renderHarness() {
	const events = createFakeServerEvents();
	const post = vi.fn().mockResolvedValue(refreshResponse);
	const container: ClientContainer = {
		api: {
			get: vi.fn().mockRejectedValue(new Error("not used")),
			put: vi.fn().mockRejectedValue(new Error("not used")),
			post,
		},
		events,
	};
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={queryClient}>
			<ClientContainerProvider container={container}>
				<Harness />
			</ClientContainerProvider>
		</QueryClientProvider>,
	);
	return { events, post };
}

describe("ChangesDetectedBanner on changeset.drifted", () => {
	it("stays hidden until the drift event arrives", () => {
		const { events } = renderHarness();
		expect(screen.queryByRole("status")).toBeNull();

		act(() => {
			events.emit({ type: "changeset.drifted" });
		});

		expect(screen.getByRole("status").textContent).toContain(
			"changes under review have moved",
		);
	});

	it("posts the refresh and clears the banner on success", async () => {
		const { events, post } = renderHarness();
		act(() => {
			events.emit({ type: "changeset.drifted" });
		});

		act(() => {
			screen.getByRole("button", { name: /refresh changeset/i }).click();
		});

		await waitFor(() => {
			expect(post).toHaveBeenCalledWith("/api/changeset/refresh");
			expect(screen.queryByRole("status")).toBeNull();
		});
	});

	it("does not react to other event types", () => {
		const { events } = renderHarness();
		act(() => {
			events.emit({ type: "heartbeat" });
			events.emit({
				type: "coverage.updated",
				updates: [],
				summary: { total: 0, byFile: {} },
			});
		});
		expect(screen.queryByRole("status")).toBeNull();
	});
});
