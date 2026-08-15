import { AppError } from "./AppError";

export type ChangesetErrorReason =
	| "not-a-repo"
	| "branch-not-found"
	| "pr-not-found"
	| "read-only-checkout";

export class ChangesetError extends AppError {
	override readonly reason: ChangesetErrorReason;

	constructor(
		reason: ChangesetErrorReason,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.reason = reason;
	}
}
