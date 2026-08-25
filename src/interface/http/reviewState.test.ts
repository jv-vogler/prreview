import { describe, expect, it } from "vitest";
import type { CurrentChangeset } from "./reviewState";
import { createReviewState } from "./reviewState";

function changesetAt(headSha: string): CurrentChangeset {
	return {
		ref: {
			source: { kind: "branch", branch: "feat/x", base: "main" },
			baseSha: "a".repeat(40),
			headSha,
			resolvedAt: "2026-08-21T00:00:00.000Z",
		},
		announce: { resolved: `feat/x at ${headSha}`, overrideHint: "x" },
		files: [],
	};
}

describe("createReviewState", () => {
	it("adopts what the resolver answers", async () => {
		const moved = changesetAt("b".repeat(40));
		const state = createReviewState(
			changesetAt("a".repeat(40)),
			async () => moved,
		);

		expect(await state.refresh()).toBe(moved);
		expect(state.current()).toBe(moved);
	});

	it("keeps the last good snapshot when the resolution fails, and rethrows", async () => {
		const initial = changesetAt("a".repeat(40));
		const state = createReviewState(initial, async () => {
			throw new Error("branch is gone");
		});

		await expect(state.refresh()).rejects.toThrow("branch is gone");
		expect(state.current()).toBe(initial);
	});
});
