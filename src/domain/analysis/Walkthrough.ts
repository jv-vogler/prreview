export interface WalkthroughStepFocus {
	path: string;
	hunkIds: string[];
}

export interface WalkthroughStep {
	index: number;
	title: string;
	narration: string;
	focus: WalkthroughStepFocus[];
}

/**
 * The persisted, UI-facing guided reading order derived from stage A
 * (ARCHITECTURE §7): ordered steps, each narrating one or more focus hunks.
 * Viewing a step marks its hunks viewed, which is why steps carry hunkIds.
 */
export interface Walkthrough {
	steps: WalkthroughStep[];
}

export interface WalkthroughProgress {
	position: number;
	completed: boolean;
}

/** every hunkId a step focuses on, deduplicated, in first-seen order */
export function walkthroughHunkIds(step: WalkthroughStep): string[] {
	const seen = new Set<string>();
	for (const focus of step.focus) {
		for (const hunkId of focus.hunkIds) {
			seen.add(hunkId);
		}
	}
	return [...seen];
}
