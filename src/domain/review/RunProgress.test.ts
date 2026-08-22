import { describe, expect, it } from "vitest";
import {
	applyRunProgress,
	describeToolActivity,
	EMPTY_RUN_PROGRESS,
} from "./RunProgress";

describe("describeToolActivity", () => {
	it("describes a Read with its target", () => {
		expect(describeToolActivity("Read", "src/index.ts")).toBe(
			"Reading src/index.ts",
		);
	});

	it("falls back to the bare verb with no target", () => {
		expect(describeToolActivity("Read")).toBe("Reading a file");
	});

	it("names an unknown tool rather than saying just 'working'", () => {
		expect(describeToolActivity("TodoWrite")).toBe("Planning its next steps");
		expect(describeToolActivity("SomeFutureTool", "x")).toBe(
			"Using SomeFutureTool x",
		);
	});

	it("shortens a target too long for one status line", () => {
		const target = `src/${"a".repeat(100)}.ts`;
		const described = describeToolActivity("Read", target);
		expect(described.length).toBeLessThan(target.length);
		expect(described.startsWith("Reading …")).toBe(true);
	});
});

describe("applyRunProgress", () => {
	it("increments toolCalls and records the activity and timestamp", () => {
		const next = applyRunProgress(
			EMPTY_RUN_PROGRESS,
			{ kind: "activity", activity: "Reading src/index.ts" },
			"2026-08-21T10:00:00.000Z",
		);
		expect(next).toEqual({
			activity: "Reading src/index.ts",
			toolCalls: 1,
			lastActivityAt: "2026-08-21T10:00:00.000Z",
		});
	});

	it("keeps counting across repeated updates", () => {
		const first = applyRunProgress(
			EMPTY_RUN_PROGRESS,
			{ kind: "activity", activity: "a" },
			"t1",
		);
		const second = applyRunProgress(
			first,
			{ kind: "activity", activity: "b" },
			"t2",
		);
		expect(second.toolCalls).toBe(2);
		expect(second.activity).toBe("b");
	});
});
