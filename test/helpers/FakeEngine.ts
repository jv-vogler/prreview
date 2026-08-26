import type { Engine } from "../../src/application/ports/Engine";
import type { TaskInput, TaskSpec } from "../../src/domain/agentTask/TaskSpec";
import type { EngineEvent } from "../../src/domain/run/EngineEvent";
import type { AgentInfo } from "../../src/domain/session/Toolchain";

export class FakeEngine implements Engine {
	events: EngineEvent[] = [];
	stopped = false;
	lastTask: TaskSpec | null = null;
	lastInput: TaskInput | null = null;

	async probe(): Promise<AgentInfo> {
		return { kind: "claude", version: "0.0.0-fake" };
	}

	async *runTask(task: TaskSpec, input: TaskInput): AsyncIterable<EngineEvent> {
		this.lastTask = task;
		this.lastInput = input;
		for (const event of this.events) {
			yield event;
		}
	}

	async stop(): Promise<void> {
		this.stopped = true;
	}
}
