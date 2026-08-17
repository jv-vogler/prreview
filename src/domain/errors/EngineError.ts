import { AppError } from "./AppError";

/**
 * Engine-run failures (ARCHITECTURE §2, §7): `agent-missing` when no agent CLI
 * survived the toolchain probe (REQ-004), `timed-out` when the task budget
 * elapsed, `crashed` when the child died or the stream ended without a result
 * event, `schema-violation` when structured output failed validation — either
 * the CLI exhausted its own retries (CON-006) or re-validation on receipt
 * rejected it (REQ-007).
 */
export type EngineErrorReason =
	| "agent-missing"
	| "timed-out"
	| "crashed"
	| "schema-violation";

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
