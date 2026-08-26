import { AppError } from "./AppError";

export type EngineErrorReason =
	| "agent-missing"
	| "timed-out"
	| "out-of-turns"
	| "crashed"
	| "schema-violation"
	| "api-error";

export class EngineError extends AppError {
	override readonly reason: EngineErrorReason;

	constructor(
		reason: EngineErrorReason,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.reason = reason;
	}
}
