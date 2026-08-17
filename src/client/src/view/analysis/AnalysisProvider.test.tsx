// @vitest-environment jsdom
import type { AnnotationDto } from "@dto/AnnotationDto";
import type { RunDto } from "@dto/RunDto";
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
import { HttpError } from "../../infrastructure/httpClients/HttpError";
import { useAnnotations } from "../annotations/useAnnotations";
import { ClientContainerProvider } from "../app/ClientContainerProvider";
import { useIntentMap } from "../orient/useIntentMap";
import { useWalkthrough } from "../walkthrough/useWalkthrough";
import { AnalysisProvider, useAnalysis } from "./AnalysisProvider";

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
			intentMapAvailable: false,
			walkthroughAvailable: false,
			annotationCount: 0,
		},
	};
}

function annotation(overrides: Partial<AnnotationDto> = {}): AnnotationDto {
	return {
		id: "a1",
		species: "explanation",
		anchor: {
			fileId: "f1",
			path: "src/server.ts",
			side: "new",
			startLine: 10,
			endLine: 14,
			placement: "in-diff",
		},
		anchorStatus: "anchored",
		body: "The port comes from the config now.",
		provenance: {
			roundId: "r1",
			stage: "comprehension",
			engineSessionId: "s1",
		},
		createdAt: "2026-08-17T10:00:00.000Z",
		category: "mechanism",
		...overrides,
	};
}

function run(overrides: Partial<RunDto> = {}): RunDto {
	return {
		id: "run-1",
		stage: "comprehension",
		lane: "analysis",
		status: "queued",
		queuedAt: "2026-08-17T10:00:00.000Z",
		...overrides,
	};
}

function Harness() {
	const analysis = useAnalysis();
	const annotations = useAnnotations();
	const { intentMap } = useIntentMap();
	const { walkthrough } = useWalkthrough();
	return (
		<div>
			<p data-testid="active">{analysis.activeRun?.status ?? "idle"}</p>
			<p data-testid="failure">{analysis.failure?.reason ?? "none"}</p>
			<p data-testid="conflict">{analysis.conflictRunId ?? "none"}</p>
			<ul data-testid="annotations">
				{annotations.map((note) => (
					<li key={note.id}>{note.id}</li>
				))}
			</ul>
			<p data-testid="intent-map">{intentMap?.summary ?? "no intent map"}</p>
			<p data-testid="walkthrough">
				{walkthrough === null
					? "no walkthrough"
					: `${walkthrough.steps.length}`}
			</p>
			<button type="button" onClick={() => analysis.startAnalysis()}>
				analyze
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
		if (path === "/api/annotations") {
			return [annotation()];
		}
		if (path === "/api/intent-map") {
			return {
				summary: "Moves the port into the config object.",
				clusters: [],
				suggestedEntryPoint: "src/server.ts",
			};
		}
		if (path === "/api/walkthrough") {
			return { steps: [] };
		}
		throw new Error(`unexpected GET ${path}`);
	});
	const post = vi.fn().mockResolvedValue({ runId: "run-1" });
	const container: ClientContainer = {
		api: {
			get,
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
				<Suspense fallback={<p>loading</p>}>
					<AnalysisProvider>
						<Harness />
					</AnalysisProvider>
				</Suspense>
			</ClientContainerProvider>
		</QueryClientProvider>,
	);
	return { events, get, post };
}

function callsTo(get: ReturnType<typeof vi.fn>, path: string): number {
	return get.mock.calls.filter(([called]) => called === path).length;
}

describe("AnalysisProvider with an agent", () => {
	it("loads the round's annotations and the artifacts once", async () => {
		const { get } = renderHarness("claude");
		await waitFor(() => {
			expect(screen.getByTestId("annotations").textContent).toBe("a1");
		});
		expect(callsTo(get, "/api/annotations")).toBe(1);
		expect(screen.getByTestId("intent-map").textContent).toContain(
			"Moves the port",
		);
	});

	it("patches the annotations cache from upsert and remove events", async () => {
		const { events, get } = renderHarness("claude");
		await waitFor(() => {
			expect(screen.getByTestId("annotations").textContent).toBe("a1");
		});

		await act(async () => {
			events.emit({
				type: "annotation.upserted",
				annotation: annotation({ id: "a2" }),
			});
			events.emit({
				type: "annotation.upserted",
				annotation: annotation({ id: "a1", body: "edited" }),
			});
		});
		await waitFor(() => {
			expect(screen.getByTestId("annotations").textContent).toBe("a1a2");
		});

		await act(async () => {
			events.emit({ type: "annotation.removed", id: "a1" });
		});
		await waitFor(() => {
			expect(screen.getByTestId("annotations").textContent).toBe("a2");
		});
		// patched, never refetched (ARCHITECTURE §9)
		expect(callsTo(get, "/api/annotations")).toBe(1);
	});

	it("follows the active run and reports why one failed", async () => {
		const { events } = renderHarness("claude");
		await screen.findByTestId("active");

		act(() => {
			events.emit({ type: "run.started", run: run({ status: "running" }) });
		});
		expect(screen.getByTestId("active").textContent).toBe("running");

		act(() => {
			events.emit({
				type: "run.failed",
				run: run({
					status: "failed",
					error: { reason: "timed-out", message: "took too long" },
				}),
			});
		});
		expect(screen.getByTestId("active").textContent).toBe("idle");
		expect(screen.getByTestId("failure").textContent).toBe("timed-out");
	});

	it("refetches the artifacts exactly once when a comprehension run succeeds", async () => {
		const { events, get } = renderHarness("claude");
		await waitFor(() => {
			expect(callsTo(get, "/api/intent-map")).toBe(1);
		});

		act(() => {
			events.emit({
				type: "run.succeeded",
				run: run({ status: "succeeded" }),
			});
		});

		await waitFor(() => {
			expect(callsTo(get, "/api/intent-map")).toBe(2);
			expect(callsTo(get, "/api/walkthrough")).toBe(2);
			expect(callsTo(get, "/api/session")).toBe(2);
		});
		expect(callsTo(get, "/api/annotations")).toBe(1);
	});

	it("ignores a chat run's success — it produced no artifacts", async () => {
		const { events, get } = renderHarness("claude");
		await waitFor(() => {
			expect(callsTo(get, "/api/intent-map")).toBe(1);
		});

		act(() => {
			events.emit({
				type: "run.succeeded",
				run: run({ id: "chat-1", stage: "chat", lane: "chat" }),
			});
		});

		await waitFor(() => {
			expect(callsTo(get, "/api/intent-map")).toBe(1);
		});
	});

	it("surfaces a 409 as the run already going, not as a failure", async () => {
		const { post } = renderHarness("claude");
		const conflict = {
			reason: "run-already-running",
			message: "already running",
			existingRunId: "run-9",
		};
		post.mockRejectedValueOnce(
			new HttpError(409, conflict.reason, conflict.message, conflict),
		);
		const button = await screen.findByRole("button", { name: "analyze" });

		act(() => {
			button.click();
		});

		await waitFor(() => {
			expect(screen.getByTestId("conflict").textContent).toBe("run-9");
		});
		expect(screen.getByTestId("failure").textContent).toBe("none");
	});
});

describe("AnalysisProvider without an agent (F12 degradation)", () => {
	it("requests nothing beyond the session and shows no AI state", async () => {
		const { get } = renderHarness("none");
		await waitFor(() => {
			expect(screen.getByTestId("annotations").textContent).toBe("");
		});

		expect(callsTo(get, "/api/session")).toBe(1);
		expect(callsTo(get, "/api/annotations")).toBe(0);
		expect(callsTo(get, "/api/intent-map")).toBe(0);
		expect(callsTo(get, "/api/walkthrough")).toBe(0);
		expect(screen.getByTestId("intent-map").textContent).toBe("no intent map");
		expect(screen.getByTestId("walkthrough").textContent).toBe(
			"no walkthrough",
		);
		expect(screen.getByTestId("active").textContent).toBe("idle");
	});
});
