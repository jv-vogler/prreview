import type { ReviewRunner } from "../../src/interface/http/reviewRunner";

export function stubReviewRunner(): ReviewRunner {
	return {
		start: () => ({ kind: "agent-missing" }),
		startRework: () => ({ kind: "agent-missing" }),
		cancelCurrent: () => false,
		current: () => null,
		currentPass: async () => null,
	};
}
