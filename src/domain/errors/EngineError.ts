import { AppError } from "./AppError";

/**
 * Engine-run failures (ARCHITECTURE §2, §7): `agent-missing` when no agent CLI
 * survived the toolchain probe (REQ-004), `timed-out` when the task budget
 * elapsed, `crashed` when the child died or the stream ended without a result
 * event, `schema-violation` when structured output failed validation — either
 * the CLI exhausted its own retries (CON-006) or re-validation on receipt
 * rejected it (REQ-007).
 *
 * `api-error` is separate from `schema-violation` on purpose, and the
 * distinction is not pedantic. A schema task that returns no structured output
 * *looks* identical in both cases, but they mean opposite things: one is the
 * agent answering badly, the other is the agent never being reached. Collapsing
 * them told users their model had produced malformed output when the truth was
 * a 404 on the model name, a 429, or a prompt over the context limit — and each
 * of those has a different fix.
 */
export type EngineErrorReason =
	| "agent-missing"
	| "timed-out"
	| "crashed"
	| "schema-violation"
	/** the API call itself failed — the agent never got to answer */
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
