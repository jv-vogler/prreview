import { describe, expect, it } from "vitest";
import { AppError } from "./AppError";
import { ChangesetError } from "./ChangesetError";
import { GithubError } from "./GithubError";
import { StoreError } from "./StoreError";

describe("error taxonomy", () => {
	it("derived errors are instances of AppError and Error", () => {
		const error = new ChangesetError("branch-not-found", "no such branch");
		expect(error).toBeInstanceOf(ChangesetError);
		expect(error).toBeInstanceOf(AppError);
		expect(error).toBeInstanceOf(Error);
	});

	it("carries the machine-readable reason", () => {
		expect(new ChangesetError("not-a-repo", "x").reason).toBe("not-a-repo");
		expect(new GithubError("unsupported-backend", "x").reason).toBe(
			"unsupported-backend",
		);
		expect(new StoreError("locked", "x").reason).toBe("locked");
	});

	it("preserves the low-level failure as cause", () => {
		const lowLevel = new Error("spawn gh ENOENT");
		const error = new GithubError("network", "GitHub is unreachable", {
			cause: lowLevel,
		});
		expect(error.cause).toBe(lowLevel);
	});

	it("names itself after the concrete class", () => {
		expect(new StoreError("corrupt", "x").name).toBe("StoreError");
	});
});
