import type { Understanding } from "../../domain/analysis/Understanding";
import type { ReadLog } from "../ports/Engine";

/**
 * `rounds/<roundId>/analysis.json` (ARCHITECTURE §11): what the comprehension
 * pass produced for this round, plus what produced it.
 *
 * The read log is kept because it is the evidence the grounding check runs
 * against: a claim is grounded only if the agent actually opened the file it
 * cites, and that is a checkable program property rather than a promise.
 */
export interface RoundAnalysis {
	understanding: Understanding;
	/** every file the agent actually read or searched (CON-007) */
	readLog: ReadLog;
	runId: string;
	engineSessionId: string;
}
