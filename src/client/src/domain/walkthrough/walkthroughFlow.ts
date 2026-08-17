/**
 * The guided reading order as a state machine (ARCHITECTURE §9). Jumping out
 * of the walkthrough to look at something else is a transition rather than a
 * boolean, which is what lets the UI offer "back to step 4" instead of
 * silently losing the reader's place.
 */
export type WalkthroughFlow =
	| { state: "not-started" }
	| { state: "at-step"; index: number }
	| { state: "detoured"; fromStep: number }
	| { state: "completed" };

export const notStartedWalkthrough: WalkthroughFlow = { state: "not-started" };

/** Entering the walkthrough, either at the top or at a restored step. */
export function startWalkthrough(index = 0): WalkthroughFlow {
	return { state: "at-step", index: Math.max(index, 0) };
}

/**
 * Forward. Past the last step the walkthrough is done — there is no step
 * `stepCount`, and pretending there is would show an empty step.
 */
export function nextStep(
	flow: WalkthroughFlow,
	stepCount: number,
): WalkthroughFlow {
	if (flow.state !== "at-step") {
		return flow;
	}
	const next = flow.index + 1;
	return next >= stepCount ? { state: "completed" } : startWalkthrough(next);
}

/** Back. The first step is the floor: there is nothing before it. */
export function previousStep(flow: WalkthroughFlow): WalkthroughFlow {
	if (flow.state !== "at-step") {
		return flow;
	}
	return startWalkthrough(Math.max(flow.index - 1, 0));
}

/**
 * The reader went to browse on their own. Only a walkthrough in progress has a
 * step to come back to, so this is a no-op from every other state.
 */
export function detour(flow: WalkthroughFlow): WalkthroughFlow {
	if (flow.state !== "at-step") {
		return flow;
	}
	return { state: "detoured", fromStep: flow.index };
}

/** Back to the step the detour left. */
export function resumeWalkthrough(flow: WalkthroughFlow): WalkthroughFlow {
	if (flow.state !== "detoured") {
		return flow;
	}
	return startWalkthrough(flow.fromStep);
}

/** Done, whether the reader stepped through the end or said so. */
export function completeWalkthrough(flow: WalkthroughFlow): WalkthroughFlow {
	if (flow.state === "not-started") {
		return flow;
	}
	return { state: "completed" };
}

/** The step the UI is (or would be) showing, if any. */
export function walkthroughStepIndex(flow: WalkthroughFlow): number | null {
	return flow.state === "at-step" ? flow.index : null;
}
