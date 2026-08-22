import type { EngineErrorReason } from "../../domain/errors/EngineError";

/**
 * The application's view of the user's agent CLI, implemented for claude by
 * infrastructure/engine/ClaudeEngine. The port exists so a second CLI could
 * follow without touching a use-case, a route, or the client.
 *
 * One shape only — there is no chat lane and no lens fan-out (PAT-001): a
 * review pass is one schema-validated task, start to finish.
 */
export interface Engine {
	probe(): Promise<AgentInfo>;
	/** one-shot, schema-validated task; yields events, ends with exactly one result */
	runTask(task: TaskSpec, input: TaskInput): AsyncIterable<EngineEvent>;
	/**
	 * Shutdown: ends every child this adapter still has running and resolves
	 * once they are gone (SEC-002 — SIGTERM, SIGKILL after the grace period).
	 * Also how a run is cancelled: breaking the `runTask` iteration stops the
	 * generator, but only a turn the generator gets to run its own cleanup on
	 * — cancellation calls this directly so a stuck child is not left behind.
	 */
	stop(): Promise<void>;
}

export interface AgentInfo {
	kind: "claude";
	version: string;
}

export interface TaskSpec {
	/** inline JSON Schema string handed to --json-schema (CON-003: < 85KB) */
	jsonSchema: string;
	maxTurns: number;
	/** how long the child may emit nothing before it is killed */
	idleTimeoutMs: number;
	systemContract: string;
	/**
	 * The same schema that produced `jsonSchema`, used to re-validate
	 * `structured_output` on receipt: engine output is never trusted just
	 * because the CLI accepted it. Shaped structurally — zod's `.parse`
	 * satisfies it — so the port stays free of a validation-library
	 * dependency.
	 */
	outputSchema: OutputParser;
}

/** throws on invalid input, exactly like `ZodType.parse` */
export interface OutputParser {
	parse(value: unknown): unknown;
}

export interface TaskInput {
	prompt: string;
	/** the directory holding the code under review — always the server's cwd (CON-010) */
	workspaceDir: string;
}

export type EngineEvent =
	| EngineSessionEvent
	| EngineToolEvent
	| EngineTextEvent
	| EngineResultEvent;

/** from the stream's system:init */
export interface EngineSessionEvent {
	type: "session";
	sessionId: string;
	cwd: string;
	model: string;
}

export interface EngineToolEvent {
	type: "tool";
	name: string;
	target?: string;
}

export interface EngineTextEvent {
	type: "text";
	text: string;
}

/** exactly one per run, always last; success keys on the stream's `is_error` */
export type EngineResultEvent = { type: "result" } & (
	| EngineRunSuccess
	| EngineRunFailure
);

export interface EngineRunSuccess {
	ok: true;
	/** re-validated by the caller's zod schema before this is trusted */
	structuredOutput: unknown;
	text: string | null;
	sessionId: string;
	/** resolved by the CLI from the user's configured default — never passed in */
	model: string;
	numTurns: number;
	costUsd: number;
}

export interface EngineRunFailure {
	ok: false;
	reason: EngineErrorReason;
	terminalReason: string | null;
	stderrTail: string;
}
