import { AppError } from "./AppError";

/**
 * Curation failures (TASK-046): `no-review` when the changeset has no saved
 * pass yet to curate, `comment-not-found` when the id does not name a
 * finding in that pass — a stale id from an earlier pass, or a typo, never
 * something to recover from silently.
 */
export type ReviewCommentErrorReason = "no-review" | "comment-not-found";

export class ReviewCommentError extends AppError {
	override readonly reason: ReviewCommentErrorReason;

	constructor(
		reason: ReviewCommentErrorReason,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.reason = reason;
	}
}
