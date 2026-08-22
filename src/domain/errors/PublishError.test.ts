import { describe, expect, it } from "vitest";
import { AppError } from "./AppError";
import { PublishError } from "./PublishError";

describe("PublishError", () => {
	it("is an AppError and an Error", () => {
		const error = new PublishError("no-github", "no backend");
		expect(error).toBeInstanceOf(PublishError);
		expect(error).toBeInstanceOf(AppError);
		expect(error).toBeInstanceOf(Error);
	});

	it("carries every machine-readable reason of the union", () => {
		expect(new PublishError("not-a-pull-request", "x").reason).toBe(
			"not-a-pull-request",
		);
		expect(new PublishError("no-github", "x").reason).toBe("no-github");
		expect(new PublishError("nothing-publishable", "x").reason).toBe(
			"nothing-publishable",
		);
	});

	it("names itself after the concrete class", () => {
		expect(new PublishError("no-github", "x").name).toBe("PublishError");
	});

	it("preserves the low-level failure as cause", () => {
		const lowLevel = new Error("gh api failed");
		const error = new PublishError("no-github", "no backend", {
			cause: lowLevel,
		});
		expect(error.cause).toBe(lowLevel);
	});
});
