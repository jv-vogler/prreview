import type { Walkthrough } from "../../domain/analysis/Walkthrough";
import type { ComprehensionOut } from "./schemas";

/**
 * The stored stage output as the walkthrough the rest of the program uses: the
 * agent emits steps in reading order, and the step's ordinal — which the UI
 * shows as "step 3 of 9" and the progress endpoint addresses by — is that
 * order, never something the model is asked to number.
 */
export function walkthroughFromComprehension(
	comprehension: ComprehensionOut,
): Walkthrough {
	return {
		steps: comprehension.walkthrough.steps.map((step, index) => ({
			index,
			title: step.title,
			narration: step.narration,
			focus: step.focus.map((focus) => ({
				path: focus.path,
				hunkIds: [...focus.hunkIds],
			})),
		})),
	};
}
