import { AppError } from "./AppError";

export type GithubErrorReason =
	| "gh-unauthenticated"
	| "unsupported-backend"
	| "network";

export class GithubError extends AppError {
	override readonly reason: GithubErrorReason;

	constructor(
		reason: GithubErrorReason,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.reason = reason;
	}
}
