import { AppError } from "./AppError";

/**
 * Negative outcomes of asking for analysis artifacts (ARCHITECTURE §8):
 * `not-produced` when stage A has not run yet, so the intent map or
 * walkthrough does not exist; `run-not-found` when a runId names no run the
 * manager knows (runs are ephemeral — a restart forgets them).
 */
export type AnalysisErrorReason = "not-produced" | "run-not-found";

export class AnalysisError extends AppError {
	override readonly reason: AnalysisErrorReason;

	constructor(
		reason: AnalysisErrorReason,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.reason = reason;
	}
}
