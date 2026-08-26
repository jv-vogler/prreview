import type { EngineErrorReason } from "../../domain/errors/EngineError";
import type { ItineraryStep } from "../../domain/run/RunProgress";

export interface Engine {
	probe(): Promise<AgentInfo>;
	runTask(task: TaskSpec, input: TaskInput): AsyncIterable<EngineEvent>;
	stop(): Promise<void>;
}

export interface AgentInfo {
	kind: "claude";
	version: string;
}

export interface TaskSpec {
	jsonSchema: string;
	maxTurns: number;
	idleTimeoutMs: number;
	systemContract: string;
	outputSchema: OutputParser;
}

export interface OutputParser {
	parse(value: unknown): unknown;
}

export interface TaskInput {
	prompt: string;
	workspaceDir: string;
}

export type EngineEvent =
	| EngineSessionEvent
	| EngineToolEvent
	| EnginePlanEvent
	| EngineTextEvent
	| EngineResultEvent;

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

export interface EnginePlanEvent {
	type: "plan";
	steps: readonly ItineraryStep[];
}

export interface EngineTextEvent {
	type: "text";
	text: string;
}

export type EngineResultEvent = { type: "result" } & (
	| EngineRunSuccess
	| EngineRunFailure
);

export interface EngineRunSuccess {
	ok: true;
	structuredOutput: unknown;
	text: string | null;
	sessionId: string;
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
