import { AppError } from "./AppError";

// `cannot-auto-detect` extends the architecture's union: bare `prreview` with
// nothing detectable is a usage error (ARCHITECTURE §3 "an error listing usage
// examples"), and the CLI edge needs a machine-readable reason to exit 2 on.
export type ChangesetErrorReason =
	| "not-a-repo"
	| "branch-not-found"
	| "pr-not-found"
	| "read-only-checkout"
	| "cannot-auto-detect";

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
