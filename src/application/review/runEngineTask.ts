import type { RunProgressUpdate } from "../../domain/run/RunProgress";
import { describeToolActivity } from "../../domain/run/RunProgress";
import type { Engine, EngineEvent, TaskInput, TaskSpec } from "../ports/Engine";
import type { RunContext, RunOutcome } from "../ports/RunManager";

export interface EngineTaskDeps {
	engine: Engine;
	report: (runId: string, update: RunProgressUpdate) => void;
}

export type EngineTaskResult =
	| { ok: true; structuredOutput: unknown }
	| { ok: false; outcome: RunOutcome };

export interface EngineTaskLabels {
	/** what ended with no result at all, in the reader's words */
	noResult: string;
	/** the fallback when the run failed and the agent said nothing on stderr */
	failed: string;
}

/**
 * One `Engine.runTask` call, from wiring the cancel through to a terminal
 * result: reports every tool call as progress, forwards the agent's own plan
 * as an itinerary, and turns "no result" and "failed" into outcomes the run
 * manager understands.
 */
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
