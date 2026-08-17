import type { ReadLog } from "../ports/Engine";
import type { ComprehensionOut } from "./schemas";

/**
 * `rounds/<roundId>/analysis.json` (ARCHITECTURE §11): the stage output exactly
 * as the agent produced it, plus what produced it. Stored raw rather than as
 * the UI-facing shapes so a later milestone can re-derive anything from it —
 * risk scores included, which M2 persists and renders nothing from (ALT-008).
 */
export interface RoundAnalysis {
	comprehension: ComprehensionOut;
	/** every file the agent actually read or searched (CON-007) */
	readLog: ReadLog;
	runId: string;
	engineSessionId: string;
}
