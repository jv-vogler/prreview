import { describe, expect, it } from "vitest";
import {
	applyRunProgress,
	describeToolActivity,
	EMPTY_RUN_PROGRESS,
} from "./RunProgress";

const AT = "2026-08-17T10:00:00.000Z";

describe("describeToolActivity", () => {
	it("names the file being read, because that is the proof of life", () => {
		expect(describeToolActivity("Read", "src/api/users.ts")).toBe(
			"Reading src/api/users.ts",
		);
	});

	it("falls back to the tool's own name rather than a reassurance", () => {
		expect(describeToolActivity("SomethingNew", "x")).toBe(
			"Using SomethingNew x",
		);
	});

	it("copes with a tool call that named no target", () => {
		expect(describeToolActivity("Read")).toBe("Reading a file");
		expect(describeToolActivity("Grep")).toBe("Searching for something");
	});

	it("trims a path too long for one line of a status bar", () => {
		const long = `src/${"deep/".repeat(30)}file.ts`;
		const described = describeToolActivity("Read", long);
		expect(described.length).toBeLessThan(90);
		expect(described).toContain("file.ts");
	});
});

describe("applyRunProgress", () => {
	it("counts an activity and stamps when it happened", () => {
		const progress = applyRunProgress(
			EMPTY_RUN_PROGRESS,
			{ kind: "activity", activity: "Reading a.ts" },
			AT,
		);

		expect(progress).toMatchObject({
			activity: "Reading a.ts",
			toolCalls: 1,
			lastActivityAt: AT,
		});
	});

	/**
	 * A fan-out reporting that a lens finished is not the agent touching
	 * anything, so it must not inflate the number that is supposed to mean
	 * exactly that.
	 */
	it("records completed parts without counting them as tool calls", () => {
		const withActivity = applyRunProgress(
			EMPTY_RUN_PROGRESS,
			{ kind: "activity", activity: "Reading a.ts" },
			AT,
		);
		const withParts = applyRunProgress(
			withActivity,
			{ kind: "parts", done: 2, total: 5 },
			AT,
		);

		expect(withParts.toolCalls).toBe(1);
		expect(withParts).toMatchObject({ partsDone: 2, partsTotal: 5 });
		// the previous activity survives: two lenses finishing does not mean the
		// remaining three stopped working
		expect(withParts.activity).toBe("Reading a.ts");
	});
});
