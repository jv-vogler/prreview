import { describe, expect, it } from "vitest";
import {
	applyRunProgress,
	applyTaskCall,
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
		expect(describeToolActivity("TaskCreate")).toBe("Planning its next steps");
		expect(describeToolActivity("TaskUpdate")).toBe("Planning its next steps");
		expect(describeToolActivity("SomeFutureTool", "x")).toBe(
			"Using SomeFutureTool x",
		);
	});

	it("names the command a Bash call is running, not just 'a command'", () => {
		expect(describeToolActivity("Bash", "npm test")).toBe(
			"Running a command: npm test",
		);
		expect(describeToolActivity("Bash")).toBe("Running a command");
	});

	it("names what a lookup is looking up", () => {
		expect(describeToolActivity("WebFetch", "https://example.invalid")).toBe(
			"Looking up https://example.invalid",
		);
		expect(describeToolActivity("WebSearch")).toBe("Looking something up");
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
			itinerary: null,
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

	it("does not bump toolCalls for an itinerary update — it is a view of the same call", () => {
		const afterActivity = applyRunProgress(
			EMPTY_RUN_PROGRESS,
			{ kind: "activity", activity: "Planning its next steps" },
			"t1",
		);
		const afterItinerary = applyRunProgress(
			afterActivity,
			{
				kind: "itinerary",
				steps: [{ label: "Find the ticket", state: "active" }],
			},
			"t2",
		);
		expect(afterItinerary.toolCalls).toBe(afterActivity.toolCalls);
		expect(afterItinerary.itinerary).toEqual([
			{ label: "Find the ticket", state: "active" },
		]);
		expect(afterItinerary.lastActivityAt).toBe("t2");
	});
});

describe("applyTaskCall", () => {
	const PLAN = [
		{ label: "Find the ticket", state: "pending" as const },
		{ label: "Read the big picture", state: "pending" as const },
	];

	it("appends a task on TaskCreate, using the real payload shape", () => {
		const steps = applyTaskCall([], "TaskCreate", {
			subject: "Find the ticket",
			description: "Locate the ticket associated with this work.",
			activeForm: "Finding the ticket",
		});
		expect(steps).toEqual([{ label: "Find the ticket", state: "pending" }]);
	});

	it("falls back to activeForm when there is no subject", () => {
		expect(
			applyTaskCall([], "TaskCreate", { activeForm: "Writing it up" }),
		).toEqual([{ label: "Writing it up", state: "pending" }]);
	});

	it("moves the task the id names, ids running from 1 in creation order", () => {
		expect(
			applyTaskCall(PLAN, "TaskUpdate", { taskId: "1", status: "completed" }),
		).toEqual([
			{ label: "Find the ticket", state: "done" },
			{ label: "Read the big picture", state: "pending" },
		]);
		expect(
			applyTaskCall(PLAN, "TaskUpdate", { taskId: "2", status: "in_progress" }),
		).toEqual([
			{ label: "Find the ticket", state: "pending" },
			{ label: "Read the big picture", state: "active" },
		]);
	});

	it("does not mutate the list it was given", () => {
		applyTaskCall(PLAN, "TaskUpdate", { taskId: "1", status: "completed" });
		expect(PLAN[0].state).toBe("pending");
	});

	it("returns null for anything it does not recognize", () => {
		expect(
			applyTaskCall([], "TaskCreate", { description: "no label" }),
		).toBeNull();
		expect(
			applyTaskCall(PLAN, "TaskUpdate", { taskId: "9", status: "completed" }),
		).toBeNull();
		expect(
			applyTaskCall(PLAN, "TaskUpdate", { taskId: "1", status: "nope" }),
		).toBeNull();
		expect(
			applyTaskCall(PLAN, "TaskUpdate", { status: "completed" }),
		).toBeNull();
		expect(applyTaskCall(PLAN, "Read", { file_path: "a.ts" })).toBeNull();
	});
});
