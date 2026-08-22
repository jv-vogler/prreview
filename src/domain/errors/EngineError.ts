import { AppError } from "./AppError";

/**
 * Engine-run failures: `agent-missing` when no agent CLI survived the
 * toolchain probe (REQ-009), `timed-out` when the run went silent past its
 * idle budget, `crashed` when the child died or the stream ended without a
 * result event, `schema-violation` when structured output failed validation
 * (the CLI exhausted its own retries, or re-validation on receipt rejected
 * it), and `api-error` when the API call itself failed — the agent never got
 * to answer. `api-error` is kept separate from `schema-violation` on purpose:
 * a schema task with no structured output looks identical in both cases, but
 * one means "the agent answered badly" and the other means "the agent was
 * never reached" — a 404 on the model name, a 429, or a prompt over the
 * context limit, each with a different fix.
 */
export type EngineErrorReason =
	| "agent-missing"
	| "timed-out"
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
