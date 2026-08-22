import { AppError } from "./AppError";

/**
 * `.prreview/` store failures: `locked` when another prreview process already
 * holds the session's pidfile, `corrupt` when a stored file is unreadable or
 * does not match its schema (delete `.prreview/` to reset — the artifact is
 * always reproducible by running the pass again, per ASSUMPTION-003).
 */
export type StoreErrorReason = "locked" | "corrupt";

export class StoreError extends AppError {
	override readonly reason: StoreErrorReason;

	constructor(
		reason: StoreErrorReason,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.reason = reason;
	}
}
