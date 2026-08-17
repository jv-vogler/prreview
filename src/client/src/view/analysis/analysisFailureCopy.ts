import type { RunFailureReasonDto } from "@dto/RunDto";

/**
 * Why the analysis did not happen, in words a reader can act on: the problem
 * first, then the way out. Exhaustive by type, so a new failure reason on the
 * wire cannot ship without someone writing what the reader should see.
 */
export const ANALYSIS_FAILURE_COPY: Record<RunFailureReasonDto, string> = {
	"agent-missing":
		"No agent CLI was found, so prreview cannot explain this change. Install and sign in to claude, then start prreview again.",
	"timed-out":
		"The agent ran out of time and was stopped. Nothing was saved — trying again usually gets through, and a smaller changeset always does.",
	crashed:
		"The agent stopped before it finished. Nothing was saved, so it is safe to try again.",
	"schema-violation":
		"The agent's answer did not fit what prreview asked for, so it was discarded rather than shown half-read. Try again.",
	internal:
		"prreview itself failed while running the analysis. Nothing was saved. If it happens twice, the terminal running prreview has the details.",
};
