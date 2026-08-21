import { describe, expect, it } from "vitest";
import { changesetIdFor } from "./ChangesetId";

describe("changesetIdFor", () => {
	it("formats each source kind", () => {
		expect(changesetIdFor({ kind: "pr", repo: "acme/api", number: 482 })).toBe(
			"pr:acme/api#482",
		);
		expect(
			changesetIdFor({ kind: "branch", branch: "feat-x", base: "main" }),
		).toBe("branch:feat-x..main");
		expect(
			changesetIdFor({ kind: "range", from: "a1b2c3", to: "d4e5f6" }),
		).toBe("range:a1b2c3..d4e5f6");
		expect(changesetIdFor({ kind: "worktree" })).toBe("worktree");
	});
});
