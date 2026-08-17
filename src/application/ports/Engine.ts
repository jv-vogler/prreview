import type { EngineErrorReason } from "../../domain/errors/EngineError";

/**
 * The application's view of the user's agent CLI (ARCHITECTURE §7),
 * implemented for claude in infrastructure/engine/ClaudeEngine. The port
 * exists so a second CLI can follow without touching a use-case, a route, or
 * the client (REQ-010, F12's adapter principle). M2 subset: §7's sketch also
 * names `dispatchFixer`, deliberately not declared until M4 implements it.
 */
export interface Engine {
	probe(): Promise<AgentInfo>;
	/** one-shot, schema-validated pipeline stage; yields events, ends with one result */
	runTask(task: TaskSpec, input: TaskInput): AsyncIterable<EngineEvent>;
	/** chat-lane turn: token streaming, no output schema (§7) */
	chatTurn(input: ChatTurnInput): AsyncIterable<EngineEvent>;
}

export interface AgentInfo {
	kind: "claude";
	version: string;
}

/** M2 runs only stage A; M3/M4 widen `stage` when B/C/D land */
export interface TaskSpec {
	stage: "comprehension";
	/** inline JSON Schema string handed to --json-schema (CON-005: < 85KB) */
	jsonSchema: string;
	maxTurns: number;
	timeoutMs: number;
	systemContract: string;
}

export interface TaskInput {
	prompt: string;
	/** the directory holding the code at the reviewed revision (REQ-005) */
	workspaceDir: string;
	resume?: SessionResume;
}

export interface ChatTurnInput {
	prompt: string;
	workspaceDir: string;
	maxTurns: number;
	timeoutMs: number;
	resume?: SessionResume;
}

/** `fork: true` must map to --fork-session — any concurrent resume without it
 * interleaves turns into the parent session file (CON-004, spike 4) */
export interface SessionResume {
	sessionId: string;
	fork: boolean;
}

export type EngineEvent =
	| EngineSessionEvent
	| EngineToolEvent
	| EngineTextEvent
	| EngineResultEvent;

/** from the stream's system:init — cwd is the engine workspace, never
 * prreview's own process cwd (CON-007) */
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

/** assistant text / partial-message deltas — the chat lane's token stream */
export interface EngineTextEvent {
	type: "text";
	text: string;
}

/** exactly one per run, always last; success keys on the stream's `is_error`,
 * never on `subtype` (CON-003) */
export type EngineResultEvent = { type: "result" } & (
	| EngineRunSuccess
	| EngineRunFailure
);

export interface EngineRunSuccess {
	ok: true;
	/** present on schema tasks; re-validated by the caller's zod schema (REQ-007) */
	structuredOutput?: unknown;
	text: string | null;
	sessionId: string;
	/** resolved by the CLI from the user's configured default — never passed in */
	model: string;
	numTurns: number;
	costUsd: number;
	readLog: ReadLog;
}

export interface EngineRunFailure {
	ok: false;
	reason: EngineErrorReason;
	terminalReason: string | null;
	stderrTail: string;
}

/** every file the agent actually saw (CON-007): Read inputs plus the paths
 * harvested from Grep/Glob tool_result contents, cwd-joined */
export interface ReadLog {
	reads: string[];
	searchHits: string[];
}
