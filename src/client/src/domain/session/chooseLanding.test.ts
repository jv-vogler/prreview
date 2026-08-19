import type { SessionDto } from "@dto/SessionDto";
import { describe, expect, it } from "vitest";
import { chooseLanding } from "./chooseLanding";

const SESSION: SessionDto = {
	changesetId: "worktree",
	source: { kind: "worktree" },
	roundId: "r1",
	resumed: false,
	toolchain: {
		agent: { kind: "claude", version: "2.1.233" },
		github: { kind: "gh" },
	},
	announce: { resolved: "working tree changes", overrideHint: "" },
	coverage: { total: 0, byFile: {} },
	analysis: {
		understandingAvailable: true,
		findingsAvailable: false,
		annotationCount: 0,
	},
};

describe("chooseLanding", () => {
	it("sends a reader who has seen nothing to the comprehension pass", () => {
		expect(chooseLanding(SESSION)).toBe("understand");
	});

	it("does not interrupt a review already under way", () => {
		expect(
			chooseLanding({ ...SESSION, coverage: { total: 40, byFile: {} } }),
		).toBe("diff");
	});

	it("sends them to the diff when no pass has run", () => {
		const analysis = { ...SESSION.analysis, understandingAvailable: false };
		expect(chooseLanding({ ...SESSION, analysis })).toBe("diff");
	});

	/*
	 * A server older than the client, which is what `npm run dev` against a stale
	 * checkout produces. `parseLogged` logs the drift and lets the payload
	 * through (CON-004), so this function receives a SessionDto with fields its
	 * type says are always there. It used to throw, which made the gate route
	 * render a stack trace instead of the app — the exact blank screen the
	 * log-don't-block boundary exists to prevent.
	 */
	it("falls back to the diff when the server predates a field it reads", () => {
		const drifted = {
			...SESSION,
			analysis: undefined,
		} as unknown as SessionDto;
		expect(chooseLanding(drifted)).toBe("diff");
	});

	it("falls back to the diff when coverage is missing too", () => {
		const drifted = {
			...SESSION,
			coverage: undefined,
		} as unknown as SessionDto;
		expect(chooseLanding(drifted)).toBe("diff");
	});
});
