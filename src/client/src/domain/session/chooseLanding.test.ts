import type { SessionAnalysisDto, SessionDto } from "@dto/SessionDto";
import { describe, expect, it } from "vitest";
import { chooseLanding } from "./chooseLanding";

function session(
	analysis: Partial<SessionAnalysisDto>,
	coverageTotal: number,
): SessionDto {
	return {
		changesetId: "worktree",
		source: { kind: "worktree" },
		roundId: "r1",
		resumed: false,
		toolchain: {
			agent: { kind: "claude", version: "2.1.233" },
			github: { kind: "none" },
		},
		announce: { resolved: "working tree", overrideHint: "" },
		coverage: { total: coverageTotal, byFile: {} },
		analysis: {
			intentMapAvailable: false,
			walkthroughAvailable: false,
			annotationCount: 0,
			...analysis,
		},
	};
}

describe("chooseLanding", () => {
	it("sends a fresh reader with an intent map to the orientation", () => {
		expect(chooseLanding(session({ intentMapAvailable: true }, 0))).toBe(
			"orient",
		);
	});

	it("keeps a review already under way on the diff", () => {
		expect(chooseLanding(session({ intentMapAvailable: true }, 12))).toBe(
			"diff",
		);
	});

	it("goes to the diff when no intent map exists yet", () => {
		expect(chooseLanding(session({ intentMapAvailable: false }, 0))).toBe(
			"diff",
		);
	});

	it("goes to the diff with neither a map nor coverage to speak of", () => {
		expect(chooseLanding(session({ intentMapAvailable: false }, 40))).toBe(
			"diff",
		);
	});
});
