import type { TaskInput, TaskSpec } from "../../domain/agentTask/TaskSpec";
import type { EngineEvent } from "../../domain/run/EngineEvent";
import type { AgentInfo } from "../../domain/session/Toolchain";

export interface Engine {
	probe(): Promise<AgentInfo>;
	runTask(task: TaskSpec, input: TaskInput): AsyncIterable<EngineEvent>;
	stop(): Promise<void>;
}
