import { describe, expect, it } from "vitest";
import type { ServerEvent } from "../dto/ServerEvent";
import { createAppEventPublisher } from "./appEventPublisher";
import type { SseHub } from "./sseHub";

describe("createAppEventPublisher", () => {
	it("maps a run's domain shape onto its wire DTO", () => {
		const sent: ServerEvent[] = [];
		const hub = {
			publish: (event: ServerEvent) => sent.push(event),
			handle: () => {
				throw new Error("not used in this test");
			},
			connectionCount: () => 0,
			stop: () => {},
		} satisfies SseHub;
		const publish = createAppEventPublisher(hub);

		publish({
			type: "run.started",
			run: {
				id: "run-1",
				kind: "review",
				status: "running",
				queuedAt: "t1",
				idleTimeoutMs: 1000,
			},
		});

		expect(sent).toEqual([
			{
				type: "run.started",
				run: {
					id: "run-1",
					kind: "review",
					status: "running",
					queuedAt: "t1",
					idleTimeoutMs: 1000,
				},
			},
		]);
	});
});
