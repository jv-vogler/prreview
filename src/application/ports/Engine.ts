import type { EngineErrorReason } from "../../domain/errors/EngineError";
import type { ReadRange } from "../../domain/review/groundingGate";

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
	/**
	 * Shutdown: end every child this adapter still has running and resolve once
	 * they are gone (SEC-002 — SIGTERM, SIGKILL after the grace period).
	 * Cancelling a run stops its stream, but stopping a stream only kills the
	 * child when the generator gets a turn to run its cleanup; on the way out
	 * there is no such turn, so the adapter is asked directly.
	 */
	stop(): Promise<void>;
}

export interface AgentInfo {
	kind: "claude";
	version: string;
}

export interface TaskSpec {
	/** `comprehension`, or `review:<lens>` for one lens child */
	stage: string;
	/** inline JSON Schema string handed to --json-schema (CON-005: < 85KB) */
	jsonSchema: string;
	maxTurns: number;
	/** how long the child may emit nothing before it is killed */
	idleTimeoutMs: number;
	systemContract: string;
	/**
	 * The same schema that produced `jsonSchema`, used to re-validate
	 * `structured_output` on receipt (REQ-007, the third validation boundary):
	 * engine output is never trusted just because the CLI accepted it. Shaped
	 * structurally — zod's `.parse` satisfies it — so the port stays free of a
	 * validation-library dependency.
	 */
	outputSchema: OutputParser;
	/** the session to fork from, for a lens child resuming comprehension */
	resume?: SessionResume;
	/**
	 * `--effort`. Accepts low/medium/high/xhigh/max on 2.1.233; prreview uses
	 * only the two ends, and never `--model` — the user's configured model is
	 * their own cost decision.
	 */
	effort?: "low" | "high";
	/**
	 * `--max-budget-usd`. Measured (CON-015) to be a **stop-threshold, not a
	 * cap**: the CLI checks it between turns, so a run halts only after it has
	 * already spent past the number. Exhaustion is clean and typed
	 * (`error_max_budget_usd` / `budget_exhausted`, exit 1).
	 */
	maxBudgetUsd?: number;
}

/** throws on invalid input, exactly like `ZodType.parse` */
export interface OutputParser {
	parse(value: unknown): unknown;
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
	idleTimeoutMs: number;
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

/**
 * Every file the agent actually saw (CON-007): `Read` inputs plus the paths
 * harvested from Grep/Glob tool_result contents, cwd-joined.
 *
 * `reads` carries the domain's `ReadRange`, not a bare path, because the range
 * is what makes line-level grounding possible: a file opened at lines 1-50
 * grounds a claim about line 12 and not one about line 900. It was recorded
 * nowhere for a while, which made the grounding gate's `outside-read-range`
 * verdict unreachable in production - an absent range reads as "the whole file",
 * so every citation inside an opened file passed. One type rather than two
 * identical ones, so the log an engine reports and the log the gate checks
 * cannot drift apart.
 */
export interface ReadLog {
	reads: ReadRange[];
	searchHits: string[];
}
