import type { ServerEvent } from "@dto/ServerEvent";
import type { SessionDto } from "@dto/SessionDto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import type { ClientContainer } from "../../infrastructure/container";
import type {
	ServerEventHandler,
	ServerEvents,
	ServerEventType,
} from "../../infrastructure/events/eventSource";
import { ClientContainerProvider } from "../app/ClientContainerProvider";

/**
 * The shell every client view test needs: the container (fake api + fake event
 * source), a query client, a router, and the suspense gate the app itself has.
 * Shared rather than copied because five surfaces in this milestone need the
 * same four wrappers, and a harness that drifts between files stops proving
 * anything.
 */

export interface FakeServerEvents extends ServerEvents {
	emit(event: ServerEvent): void;
}

export function createFakeServerEvents(): FakeServerEvents {
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

export type AgentKind = "claude" | "none";

export function sessionDto(
	agent: AgentKind,
	overrides: Partial<SessionDto> = {},
): SessionDto {
	return {
		changesetId: "worktree",
		source: { kind: "worktree" },
		roundId: "r1",
		resumed: false,
		toolchain: {
			agent:
				agent === "claude"
					? { kind: "claude", version: "2.1.233" }
					: { kind: "none" },
			github: { kind: "none" },
		},
		announce: { resolved: "working tree", overrideHint: "" },
		coverage: { total: 0, byFile: {} },
		analysis: {
			intentMapAvailable: false,
			walkthroughAvailable: false,
			annotationCount: 0,
		},
		...overrides,
	};
}

export interface RenderOptions {
	/**
	 * Answers for `api.get`, keyed by path. An `Error` value is thrown instead of
	 * returned, which is how a test says "this endpoint answers 404 not-produced".
	 * An unlisted path throws, so a surface that requests more than the test
	 * expected fails loudly.
	 */
	responses?: Record<string, unknown>;
	initialPath?: string;
}

export function renderWithProviders(
	ui: ReactNode,
	options: RenderOptions = {},
) {
	const responses = options.responses ?? {};
	const events = createFakeServerEvents();
	const get = vi.fn(async (path: string) => {
		if (!(path in responses)) {
			throw new Error(`unexpected GET ${path}`);
		}
		const answer = responses[path];
		if (answer instanceof Error) {
			throw answer;
		}
		return answer;
	});
	const post = vi.fn().mockResolvedValue({ runId: "run-1" });
	const put = vi.fn().mockResolvedValue({});
	const container: ClientContainer = { api: { get, post, put }, events };
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

	const result = render(
		<QueryClientProvider client={queryClient}>
			<ClientContainerProvider container={container}>
				<MemoryRouter initialEntries={[options.initialPath ?? "/diff"]}>
					<Suspense fallback={<p>loading</p>}>{ui}</Suspense>
				</MemoryRouter>
			</ClientContainerProvider>
		</QueryClientProvider>,
	);
	return { ...result, events, get, post, put, queryClient };
}
