import { describe, expect, it } from "vitest";
import { AppError } from "./AppError";
import { ValidationError } from "./ValidationError";

describe("ValidationError", () => {
	it("is an AppError and an Error", () => {
		const error = new ValidationError("bad body");
		expect(error).toBeInstanceOf(ValidationError);
		expect(error).toBeInstanceOf(AppError);
		expect(error).toBeInstanceOf(Error);
	});

	it("carries the fixed reason", () => {
		expect(new ValidationError("bad body").reason).toBe("validation");
	});

	it("names itself after the concrete class", () => {
		expect(new ValidationError("bad body").name).toBe("ValidationError");
	});

	it("preserves the low-level failure as cause", () => {
		const lowLevel = new Error("invalid json");
		const error = new ValidationError("bad body", { cause: lowLevel });
		expect(error.cause).toBe(lowLevel);
	});
});
