import { AppError } from "./AppError";

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
