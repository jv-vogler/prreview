import { describe, expect, it } from "vitest";
import { AppError } from "./AppError";
import { ChangesetError } from "./ChangesetError";

describe("ChangesetError", () => {
	it("is an AppError and an Error", () => {
		const error = new ChangesetError("branch-not-found", "no such branch");
		expect(error).toBeInstanceOf(ChangesetError);
		expect(error).toBeInstanceOf(AppError);
		expect(error).toBeInstanceOf(Error);
	});

	it("carries every machine-readable reason of the union", () => {
		expect(new ChangesetError("not-a-repo", "x").reason).toBe("not-a-repo");
		expect(new ChangesetError("branch-not-found", "x").reason).toBe(
			"branch-not-found",
		);
		expect(new ChangesetError("pr-not-found", "x").reason).toBe("pr-not-found");
		expect(new ChangesetError("read-only-checkout", "x").reason).toBe(
			"read-only-checkout",
		);
		expect(new ChangesetError("cannot-auto-detect", "x").reason).toBe(
			"cannot-auto-detect",
		);
	});

	it("names itself after the concrete class", () => {
		expect(new ChangesetError("not-a-repo", "x").name).toBe("ChangesetError");
	});
});
