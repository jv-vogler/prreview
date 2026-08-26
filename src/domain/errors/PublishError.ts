import { AppError } from "./AppError";

export type PublishErrorReason =
	| "not-a-pull-request"
	| "no-github"
	| "nothing-publishable";

export class PublishError extends AppError {
	override readonly reason: PublishErrorReason;

	constructor(
		reason: PublishErrorReason,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.reason = reason;
	}
}
