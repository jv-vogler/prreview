import { AppError } from "./AppError";

/**
 * Publish-time failures (TASK-050, TASK-053): `not-a-pull-request` when the
 * changeset on screen has no PR to publish to, `no-github` when no
 * GithubService backend is available — absent, not disabled, mirroring
 * REQ-009's treatment of a missing agent — and `nothing-publishable` when
 * every comment in the pass was excluded (REQ-011) and there is nothing left
 * to send.
 */
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
