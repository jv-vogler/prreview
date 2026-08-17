import { describe, expect, it } from "vitest";
import { AnalysisError } from "./AnalysisError";
import { AppError } from "./AppError";

describe("AnalysisError", () => {
	it("is an AppError and an Error", () => {
		const error = new AnalysisError("not-produced", "stage A has not run");
		expect(error).toBeInstanceOf(AnalysisError);
		expect(error).toBeInstanceOf(AppError);
		expect(error).toBeInstanceOf(Error);
	});

	it("carries every machine-readable reason of the union", () => {
		expect(new AnalysisError("not-produced", "x").reason).toBe("not-produced");
		expect(new AnalysisError("run-not-found", "x").reason).toBe(
			"run-not-found",
		);
	});

	it("names itself after the concrete class", () => {
		expect(new AnalysisError("run-not-found", "x").name).toBe("AnalysisError");
	});
});
