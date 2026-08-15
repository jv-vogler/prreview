import { describe, expect, it } from "vitest";
import { sessionKeyFor } from "./sessionKey";

describe("sessionKeyFor", () => {
	it("slugs a PR id", () => {
		expect(sessionKeyFor("pr:acme/api#482")).toBe("pr-acme-api-482");
	});

	it("keeps worktree as-is", () => {
		expect(sessionKeyFor("worktree")).toBe("worktree");
	});

	it("slugs branch and range ids", () => {
		expect(sessionKeyFor("branch:feat/x..main")).toBe("branch-feat-x-main");
		expect(sessionKeyFor("range:a1b2c3..d4e5f6")).toBe("range-a1b2c3-d4e5f6");
	});

	it("lowercases and never emits leading or trailing separators", () => {
		expect(sessionKeyFor("branch:Feature/UPPER..main")).toBe(
			"branch-feature-upper-main",
		);
		expect(sessionKeyFor("##")).toBe("session");
	});
});
