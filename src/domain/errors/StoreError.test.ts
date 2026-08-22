import { describe, expect, it } from "vitest";
import { AppError } from "./AppError";
import { StoreError } from "./StoreError";

describe("StoreError", () => {
	it("is an AppError and an Error", () => {
		const error = new StoreError(
			"locked",
			"another prreview holds this session",
		);
		expect(error).toBeInstanceOf(StoreError);
		expect(error).toBeInstanceOf(AppError);
		expect(error).toBeInstanceOf(Error);
	});

	it("carries every machine-readable reason of the union", () => {
		expect(new StoreError("locked", "x").reason).toBe("locked");
		expect(new StoreError("corrupt", "x").reason).toBe("corrupt");
	});

	it("names itself after the concrete class", () => {
		expect(new StoreError("corrupt", "x").name).toBe("StoreError");
	});
});
