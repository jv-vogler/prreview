import { describe, expect, it } from "vitest";
import { AppError } from "./AppError";
import { GithubError } from "./GithubError";

describe("GithubError", () => {
	it("is an AppError and an Error", () => {
		const error = new GithubError("network", "GitHub is unreachable");
		expect(error).toBeInstanceOf(GithubError);
		expect(error).toBeInstanceOf(AppError);
		expect(error).toBeInstanceOf(Error);
	});

	it("carries every machine-readable reason of the union", () => {
		expect(new GithubError("gh-unauthenticated", "x").reason).toBe(
			"gh-unauthenticated",
		);
		expect(new GithubError("unsupported-backend", "x").reason).toBe(
			"unsupported-backend",
		);
		expect(new GithubError("network", "x").reason).toBe("network");
	});

	it("names itself after the concrete class", () => {
		expect(new GithubError("network", "x").name).toBe("GithubError");
	});

	it("preserves the low-level failure as cause", () => {
		const lowLevel = new Error("spawn gh ENOENT");
		const error = new GithubError("network", "GitHub is unreachable", {
			cause: lowLevel,
		});
		expect(error.cause).toBe(lowLevel);
	});
});
