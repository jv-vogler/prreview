import type { DiscardReasonKindDto } from "@dto/ReviewSummaryDto";

/**
 * Why a candidate did not make the cut, in words.
 *
 * One closed table, so a new reason cannot ship without user-facing text for it
 * — the same rule the run-failure copy follows. Each line says what the gate
 * was protecting the reader from, because "form" on its own is a category name
 * and tells them nothing about whether the right thing was cut.
 */
const COPY: Record<DiscardReasonKindDto, string> = {
	"ungrounded-blocker":
		"Named a blocking problem in code the agent never opened. Dropped rather than shown: a confident claim about unread code costs more than it can be worth.",
	form: "Written in a shape a reviewer skims past — too long, too much preamble, or reading like a machine rather than a colleague.",
	"below-confidence-floor":
		"The agent was not sure enough of it. A maybe costs the reader the same attention as a certainty and is worth less.",
};

export function discardReasonCopy(reason: DiscardReasonKindDto): string {
	return COPY[reason];
}

const HEADING: Record<DiscardReasonKindDto, string> = {
	"ungrounded-blocker": "Not grounded in code the agent read",
	form: "Badly written",
	"below-confidence-floor": "Too unsure",
};

export function discardReasonHeading(reason: DiscardReasonKindDto): string {
	return HEADING[reason];
}
