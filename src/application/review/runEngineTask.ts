import type { TaskInput, TaskSpec } from "../../domain/agentTask/TaskSpec";
import type { EngineEvent } from "../../domain/run/EngineEvent";
import type { RunProgressUpdate } from "../../domain/run/RunProgress";
import { describeToolActivity } from "../../domain/run/RunProgress";
import type { Engine } from "../ports/Engine";
import type { RunContext, RunOutcome } from "../ports/RunManager";

export interface EngineTaskDeps {
	engine: Engine;
	report: (runId: string, update: RunProgressUpdate) => void;
}

export type EngineTaskResult =
	| { ok: true; structuredOutput: unknown }
	| { ok: false; outcome: RunOutcome };

export interface EngineTaskLabels {
	noResult: string;
	failed: string;
}

export async function runEngineTask(
	deps: EngineTaskDeps,
	context: RunContext,
	task: TaskSpec,
	input: TaskInput,
	labels: EngineTaskLabels,
): Promise<EngineTaskResult> {
	const onAbort = () => {
		void deps.engine.stop();
	};
	context.signal.addEventListener("abort", onAbort);
	if (context.signal.aborted) {
		onAbort();
	}

	try {
		let terminal: Extract<EngineEvent, { type: "result" }> | null = null;
		for await (const event of deps.engine.runTask(task, input)) {
			terminal = report(deps, context.runId, event) ?? terminal;
		}
		if (terminal === null) {
			return {
				ok: false,
				outcome: { ok: false, reason: "crashed", message: labels.noResult },
			};
		}
		if (!terminal.ok) {
			return {
				ok: false,
				outcome: {
					ok: false,
					reason: terminal.reason,
					message: terminal.stderrTail || labels.failed,
				},
			};
		}
		return { ok: true, structuredOutput: terminal.structuredOutput };
	} finally {
		context.signal.removeEventListener("abort", onAbort);
	}
}

function report(
	deps: EngineTaskDeps,
	runId: string,
	event: EngineEvent,
): Extract<EngineEvent, { type: "result" }> | null {
	if (event.type === "tool") {
		deps.report(runId, {
			kind: "activity",
			activity: describeToolActivity(event.name, event.target),
		});
		return null;
	}
	if (event.type === "plan") {
		deps.report(runId, { kind: "itinerary", steps: event.steps });
		return null;
	}
	return event.type === "result" ? event : null;
}
