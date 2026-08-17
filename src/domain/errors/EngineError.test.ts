import { describe, expect, it } from "vitest";
import { AppError } from "./AppError";
import { EngineError } from "./EngineError";

describe("EngineError", () => {
	it("is an AppError and an Error", () => {
		const error = new EngineError("agent-missing", "no agent CLI installed");
		expect(error).toBeInstanceOf(EngineError);
		expect(error).toBeInstanceOf(AppError);
		expect(error).toBeInstanceOf(Error);
	});

	it("carries every machine-readable reason of the §2 union", () => {
		expect(new EngineError("agent-missing", "x").reason).toBe("agent-missing");
		expect(new EngineError("timed-out", "x").reason).toBe("timed-out");
		expect(new EngineError("crashed", "x").reason).toBe("crashed");
		expect(new EngineError("schema-violation", "x").reason).toBe(
			"schema-violation",
		);
	});

	it("preserves the low-level failure as cause", () => {
		const lowLevel = new Error("spawn claude ENOENT");
		const error = new EngineError("crashed", "engine child died", {
			cause: lowLevel,
		});
		expect(error.cause).toBe(lowLevel);
	});

	it("names itself after the concrete class", () => {
		expect(new EngineError("timed-out", "x").name).toBe("EngineError");
	});
});
