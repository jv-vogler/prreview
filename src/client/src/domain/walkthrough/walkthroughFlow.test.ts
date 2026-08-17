import { describe, expect, it } from "vitest";
import {
	completeWalkthrough,
	detour,
	leaveWalkthrough,
	nextStep,
	notStartedWalkthrough,
	previousStep,
	resumeWalkthrough,
	startWalkthrough,
	walkthroughStepIndex,
} from "./walkthroughFlow";

const STEP_COUNT = 3;

describe("walkthroughFlow", () => {
	it("starts at the first step, or at a restored one", () => {
		expect(startWalkthrough()).toEqual({ state: "at-step", index: 0 });
		expect(startWalkthrough(2)).toEqual({ state: "at-step", index: 2 });
	});

	it("clamps a negative restored step to the first one", () => {
		expect(startWalkthrough(-1)).toEqual({ state: "at-step", index: 0 });
	});

	it("steps forward and completes past the last step", () => {
		const first = startWalkthrough();
		const second = nextStep(first, STEP_COUNT);
		const third = nextStep(second, STEP_COUNT);

		expect(second).toEqual({ state: "at-step", index: 1 });
		expect(third).toEqual({ state: "at-step", index: 2 });
		expect(nextStep(third, STEP_COUNT)).toEqual({ state: "completed" });
	});

	it("steps back and stops at the first step", () => {
		expect(previousStep(startWalkthrough(2))).toEqual({
			state: "at-step",
			index: 1,
		});
		expect(previousStep(startWalkthrough(0))).toEqual({
			state: "at-step",
			index: 0,
		});
	});

	it("remembers the step a detour left and returns to it", () => {
		const detoured = detour(startWalkthrough(1));
		expect(detoured).toEqual({ state: "detoured", fromStep: 1 });
		expect(resumeWalkthrough(detoured)).toEqual({ state: "at-step", index: 1 });
	});

	it("completes from a step and from a detour, but not from not-started", () => {
		expect(completeWalkthrough(startWalkthrough(1))).toEqual({
			state: "completed",
		});
		expect(completeWalkthrough(detour(startWalkthrough(1)))).toEqual({
			state: "completed",
		});
		expect(completeWalkthrough(notStartedWalkthrough)).toBe(
			notStartedWalkthrough,
		);
	});

	it("ignores transitions that make no sense from the current state", () => {
		const completed = { state: "completed" } as const;
		expect(nextStep(notStartedWalkthrough, STEP_COUNT)).toBe(
			notStartedWalkthrough,
		);
		expect(previousStep(notStartedWalkthrough)).toBe(notStartedWalkthrough);
		expect(nextStep(completed, STEP_COUNT)).toBe(completed);
		expect(detour(completed)).toBe(completed);
		expect(detour(notStartedWalkthrough)).toBe(notStartedWalkthrough);
		expect(resumeWalkthrough(startWalkthrough(1))).toEqual({
			state: "at-step",
			index: 1,
		});
		expect(resumeWalkthrough(completed)).toBe(completed);
	});

	it("leaves without claiming the walkthrough was finished", () => {
		expect(leaveWalkthrough()).toBe(notStartedWalkthrough);
		expect(leaveWalkthrough()).not.toEqual({ state: "completed" });
	});

	it("names the step being shown, and only while one is", () => {
		expect(walkthroughStepIndex(startWalkthrough(2))).toBe(2);
		expect(walkthroughStepIndex(detour(startWalkthrough(2)))).toBeNull();
		expect(walkthroughStepIndex(notStartedWalkthrough)).toBeNull();
		expect(walkthroughStepIndex({ state: "completed" })).toBeNull();
	});

	it("survives a detour and resume around a full pass", () => {
		let flow = startWalkthrough();
		flow = nextStep(flow, STEP_COUNT);
		flow = detour(flow);
		expect(flow).toEqual({ state: "detoured", fromStep: 1 });
		flow = resumeWalkthrough(flow);
		flow = nextStep(flow, STEP_COUNT);
		flow = nextStep(flow, STEP_COUNT);
		expect(flow).toEqual({ state: "completed" });
	});
});
