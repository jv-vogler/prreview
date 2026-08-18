import { describe, expect, it } from "vitest";
import type { AppEvent } from "../../../application/ports/EventPublisher";
import type { Run } from "../../../application/ports/RunManager";
import type { StoredAnnotation } from "../../../domain/annotation/Annotation";
import type { ServerEvent } from "../dto/ServerEvent";
import { serverEventSchema } from "../dto/ServerEvent";
import type { ReviewState } from "../reviewState";
import { createAppEventPublisher } from "./appEventPublisher";
import type { SseHub } from "./sseHub";

const COALESCE_MS = 20;

const RUN: Run = {
	id: "run-1",
	lane: "analysis",
	taskType: "comprehension",
	status: "running",
	queuedAt: "2026-08-17T10:00:00.000Z",
	startedAt: "2026-08-17T10:00:01.000Z",
	timeoutMs: 600_000,
};

const ANNOTATION: StoredAnnotation = {
	id: "01J000000000000000000000",
	species: "explanation",
	anchorStatus: "anchored",
	body: "the flag defaults to false",
	createdAt: "2026-08-17T10:00:02.000Z",
	provenance: {
		roundId: "r1",
		stage: "comprehension",
		engineSessionId: "session-1",
	},
	anchor: {
		fileId: "f1",
		path: "src/greeting.ts",
		side: "new",
		startLine: 2,
		endLine: 2,
		placement: "in-diff",
		snapshot: {
			blobOid: "2".repeat(40),
			targetLines: ['return "hello, reviewer";'],
			lineHash: "a".repeat(64),
			contextBefore: [],
			contextAfter: [],
		},
	},
};

interface Harness {
	publish: (event: AppEvent) => void;
	sent: ServerEvent[];
	stop: () => void;
	annotationCacheDrops: number;
	analysisCacheDrops: number;
}

function harness(): Harness {
	const sent: ServerEvent[] = [];
	const hub = {
		publish: (event: ServerEvent) => {
			sent.push(serverEventSchema.parse(event));
		},
	} as SseHub;
	const record = { annotationCacheDrops: 0, analysisCacheDrops: 0 };
	const state = {
		applyAnnotations: (value: unknown) => {
			if (value === null) {
				record.annotationCacheDrops++;
			}
		},
		applyAnalysis: (value: unknown) => {
			if (value === null) {
				record.analysisCacheDrops++;
			}
		},
	} as ReviewState;

	const publisher = createAppEventPublisher({ coalesceMs: COALESCE_MS });
	publisher.connect({ hub, state });
	return {
		publish: publisher.publish,
		sent,
		stop: publisher.stop,
		get annotationCacheDrops() {
			return record.annotationCacheDrops;
		},
		get analysisCacheDrops() {
			return record.analysisCacheDrops;
		},
	};
}

describe("createAppEventPublisher", () => {
	it("maps a run's lifecycle onto run.* events carrying a RunDto", async () => {
		const app = harness();
		app.publish({ type: "run.started", run: RUN });

		expect(app.sent).toEqual([
			{
				type: "run.started",
				run: {
					id: "run-1",
					stage: "comprehension",
					lane: "analysis",
					status: "running",
					queuedAt: RUN.queuedAt,
					startedAt: RUN.startedAt,
					timeoutMs: RUN.timeoutMs,
				},
			},
		]);
	});

	it("sends an annotation without its anchor snapshot", async () => {
		const app = harness();
		app.publish({ type: "annotation.upserted", annotation: ANNOTATION });

		const [event] = app.sent;
		if (event?.type !== "annotation.upserted") {
			throw new Error("expected an annotation event");
		}
		expect(event.annotation.anchor).not.toHaveProperty("snapshot");
		expect(event.annotation.body).toBe(ANNOTATION.body);
	});

	it("coalesces token deltas into one frame per window (RISK-008)", async () => {
		const app = harness();
		for (const text of ["The ", "greeting ", "changed."]) {
			app.publish({ type: "chat.turn.delta", turnId: "t-1", text });
		}
		expect(app.sent).toEqual([]);

		await new Promise((resolve) => setTimeout(resolve, COALESCE_MS * 3));
		expect(app.sent).toEqual([
			{ type: "chat.turn.delta", turnId: "t-1", text: "The greeting changed." },
		]);
	});

	it("flushes buffered deltas before the message they belong to", async () => {
		const app = harness();
		app.publish({ type: "chat.turn.started", turnId: "t-1" });
		app.publish({ type: "chat.turn.delta", turnId: "t-1", text: "half a " });
		app.publish({
			type: "chat.turn.completed",
			turnId: "t-1",
			message: { role: "assistant", text: "half a sentence", at: "now" },
		});

		expect(app.sent.map((event) => event.type)).toEqual([
			"chat.turn.started",
			"chat.turn.delta",
			"chat.turn.completed",
		]);
	});

	it("flushes buffered deltas before a failure, too", async () => {
		const app = harness();
		app.publish({ type: "chat.turn.delta", turnId: "t-1", text: "well" });
		app.publish({
			type: "chat.turn.failed",
			turnId: "t-1",
			reason: "timed-out",
			message: "the answer took too long",
		});

		expect(app.sent.map((event) => event.type)).toEqual([
			"chat.turn.delta",
			"chat.turn.failed",
		]);
	});

	it("drops the annotation cache so the next request re-reads the store", async () => {
		const app = harness();
		app.publish({ type: "annotation.upserted", annotation: ANNOTATION });
		app.publish({ type: "annotation.removed", id: ANNOTATION.id });

		expect(app.annotationCacheDrops).toBe(2);
		expect(app.analysisCacheDrops).toBe(0);
	});

	it("drops the analysis cache when an analysis run succeeds", async () => {
		const app = harness();
		app.publish({
			type: "run.succeeded",
			run: { ...RUN, status: "succeeded" },
		});
		app.publish({
			type: "run.succeeded",
			run: { ...RUN, id: "run-2", lane: "chat", taskType: "chat" },
		});

		expect(app.analysisCacheDrops).toBe(1);
	});

	it("drops events published before the channel exists", () => {
		const publisher = createAppEventPublisher({ coalesceMs: COALESCE_MS });
		expect(() =>
			publisher.publish({ type: "run.started", run: RUN }),
		).not.toThrow();
		publisher.stop();
	});

	it("flushes what is pending when it stops", () => {
		const app = harness();
		app.publish({ type: "chat.turn.delta", turnId: "t-1", text: "last word" });
		app.stop();

		expect(app.sent).toEqual([
			{ type: "chat.turn.delta", turnId: "t-1", text: "last word" },
		]);
	});
});
