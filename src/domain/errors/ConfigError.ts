import { AppError } from "./AppError";

/**
 * Something the user asked for at startup cannot be honoured.
 *
 * `invalid-brain` is fatal on purpose. When `--brain` is passed and the
 * document cannot be loaded, prreview refuses to boot rather than reviewing
 * without it: a review that silently ignores the rules you pointed it at is
 * worse than no review, because you would trust its output while it measured
 * against the wrong thing.
 */
export type ConfigErrorReason = "invalid-brain";

export class ConfigError extends AppError {
	override readonly reason: ConfigErrorReason;

	constructor(
		reason: ConfigErrorReason,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.reason = reason;
	}
}
