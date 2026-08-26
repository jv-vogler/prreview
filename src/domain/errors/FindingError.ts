import { AppError } from "./AppError";

/**
 * Curation failures (TASK-046): `no-review` when the changeset has no saved
 * pass yet to curate, `comment-not-found` when the id does not name a
 * finding in that pass — a stale id from an earlier pass, or a typo, never
 * something to recover from silently.
 */
export type FindingErrorReason = "no-review" | "comment-not-found";

export class FindingError extends AppError {
	override readonly reason: FindingErrorReason;

	constructor(
		reason: FindingErrorReason,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.reason = reason;
	}
}
