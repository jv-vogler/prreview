import type {
	AgentInfo,
	Engine,
	EngineEvent,
	TaskInput,
	TaskSpec,
} from "../../src/application/ports/Engine";

/**
 * In-memory Engine fake: events are scripted per test, `stop()` is recorded
 * so a cancellation test can assert the engine was actually told to die.
 */
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
