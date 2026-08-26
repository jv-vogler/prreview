import { describe, expect, it } from "vitest";
import { FakeGit } from "../../../test/helpers/FakeGit";
import { assessPassFreshness } from "./passFreshness";

describe("assessPassFreshness", () => {
	it("answers same-commit when the shas match", async () => {
		const freshness = await assessPassFreshness(
			{ git: new FakeGit() },
			"abc",
			"abc",
		);
		expect(freshness).toEqual({ kind: "same-commit" });
	});

	it("counts the commits between the reviewed and current heads", async () => {
		const git = new FakeGit({ commitCounts: { "old..new": 3 } });
		const freshness = await assessPassFreshness({ git }, "old", "new");
		expect(freshness).toEqual({ kind: "new-commits", count: 3 });
	});

	it("answers unknown for a worktree pass (no sha on either side)", async () => {
		const git = new FakeGit();
		expect(await assessPassFreshness({ git }, null, "new")).toEqual({
			kind: "unknown",
		});
		expect(await assessPassFreshness({ git }, "old", null)).toEqual({
			kind: "unknown",
		});
	});

	it("answers unknown when the reviewed commit is gone or the count is zero", async () => {
		const gone = new FakeGit();
		expect(await assessPassFreshness({ git: gone }, "old", "new")).toEqual({
			kind: "unknown",
		});
		const rewritten = new FakeGit({ commitCounts: { "old..new": 0 } });
		expect(await assessPassFreshness({ git: rewritten }, "old", "new")).toEqual(
			{ kind: "unknown" },
		);
	});
});
