import type { ReviewRunner } from "../../src/interface/http/reviewRunner";

/** A ReviewRunner stub for route tests that have nothing to do with review runs. */
export function stubReviewRunner(): ReviewRunner {
	return {
		start: () => ({ kind: "agent-missing" }),
		startRework: () => ({ kind: "agent-missing" }),
		cancelCurrent: () => false,
		current: () => null,
		currentPass: async () => null,
	};
}
