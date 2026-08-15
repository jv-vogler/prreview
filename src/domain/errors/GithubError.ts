import { AppError } from "./AppError";

// M1 subset; `pending-review-exists` and `anchor-rejected` join in M4 with publishing.
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
