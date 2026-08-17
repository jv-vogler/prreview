import type { RunFailureReasonDto } from "@dto/RunDto";

/**
 * Why a question went unanswered, in words a reader can act on. Exhaustive by
 * type, exactly like the analysis tray's table, so a new failure reason on the
 * wire cannot ship without someone writing what the reader should see.
 *
 * Its own words rather than the tray's: the tray talks about "the analysis",
 * and telling someone their *question* failed while running an analysis would
 * simply be false.
 */
export const CHAT_FAILURE_COPY: Record<RunFailureReasonDto, string> = {
	"agent-missing":
		"No agent CLI was found, so there is nothing to ask. Install and sign in to claude, then start prreview again.",
	"timed-out":
		"The agent ran out of time before answering and was stopped. A narrower question usually gets through.",
	crashed: "The agent stopped before answering. Asking again is safe.",
	"schema-violation":
		"The agent's answer did not fit what prreview asked for, so it was discarded rather than shown half-read. Ask again.",
	internal:
		"prreview itself failed while asking. Nothing was lost; the terminal running prreview has the details.",
};
