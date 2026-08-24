/**
 * What the review run is doing right now, phrased the way a person would say
 * it.
 *
 * This type exists because a run showing no progress is indistinguishable
 * from a run that has hung, and those two need different reactions from the
 * reader. The engine already knows it just opened `src/api/users.ts` — the
 * information is arriving on the stream — so throwing it away and leaving
 * the screen at "Running…" for minutes is what makes a slow run feel like a
 * broken one (REQ-008).
 */
export interface RunProgress {
	/** the current move, in the reader's words; null before the agent's first */
	activity: string | null;
	/** tool calls so far — the number that proves the run is alive */
	toolCalls: number;
	/** the agent's own plan, echoed back; null until it writes one */
	itinerary: readonly ItineraryStep[] | null;
	/** when the last move was observed: empty on the client's stall clock */
	lastActivityAt: string;
}

/** One step of the agent's own plan, in its own wording. */
export interface ItineraryStep {
	/** the agent's own wording for this step */
	label: string;
	state: "pending" | "active" | "done";
}

export type RunProgressUpdate =
	| { kind: "activity"; activity: string }
	| { kind: "itinerary"; steps: readonly ItineraryStep[] };

export const EMPTY_RUN_PROGRESS: RunProgress = {
	activity: null,
	toolCalls: 0,
	itinerary: null,
	lastActivityAt: "",
};

/**
 * A tool call as a sentence.
 *
 * Deliberately concrete: "Reading src/domain/review/reviewPrompt.ts" tells
 * the reader the agent is working through their code, which is the one thing
 * a spinner cannot say. Unknown tools fall back to their own name rather
 * than to a generic "working" — a name the reader can look up beats a
 * reassurance.
 */
export function describeToolActivity(name: string, target?: string): string {
	const subject = target === undefined ? "" : ` ${shorten(target)}`;
	switch (name) {
		case "Read":
			return `Reading${subject === "" ? " a file" : subject}`;
		case "Grep":
			return `Searching for${subject === "" ? " something" : subject}`;
		case "Glob":
			return `Looking for files${subject === "" ? "" : ` matching${subject}`}`;
		case "Bash":
			return `Running a command${subject === "" ? "" : `:${subject}`}`;
		case "Write":
			return `Writing${subject === "" ? " a file" : subject}`;
		case "Edit":
			return `Editing${subject === "" ? " a file" : subject}`;
		case TASK_CREATE_TOOL:
		case TASK_UPDATE_TOOL:
		case "TaskList":
		case "TaskGet":
			return "Planning its next steps";
		case "WebFetch":
		case "WebSearch":
			return subject === "" ? "Looking something up" : `Looking up${subject}`;
		default:
			return `Using ${name}${subject}`;
	}
}

/** long enough to identify a path, short enough for one line of a status bar */
const MAX_TARGET_CHARS = 72;

function shorten(target: string): string {
	if (target.length <= MAX_TARGET_CHARS) {
		return target;
	}
	return `…${target.slice(-(MAX_TARGET_CHARS - 1))}`;
}

/** Folds one update into a run's progress. */
export function applyRunProgress(
	current: RunProgress,
	update: RunProgressUpdate,
	at: string,
): RunProgress {
	if (update.kind === "itinerary") {
		// a plan update is a view of the tool call the activity update already
		// counted, not a second move — toolCalls stays put
		return { ...current, itinerary: update.steps, lastActivityAt: at };
	}
	return {
		...current,
		activity: update.activity,
		toolCalls: current.toolCalls + 1,
		lastActivityAt: at,
	};
}

const TASK_STATE: Record<string, ItineraryStep["state"]> = {
	completed: "done",
	in_progress: "active",
	pending: "pending",
};

export const TASK_CREATE_TOOL = "TaskCreate";
export const TASK_UPDATE_TOOL = "TaskUpdate";

/**
 * The agent's plan arrives one call at a time — `TaskCreate` appends a task,
 * `TaskUpdate` moves one by id — so the list has to be accumulated rather
 * than read whole out of any single call. Ids are assigned in creation order
 * starting at 1, which is what makes the index derivable without reading the
 * tool results back.
 *
 * Returns null for any call this does not recognize, leaving the caller's
 * existing list untouched.
 */
export function applyTaskCall(
	steps: readonly ItineraryStep[],
	toolName: string,
	input: Record<string, unknown>,
): ItineraryStep[] | null {
	if (toolName === TASK_CREATE_TOOL) {
		const label = firstNonEmptyString(input.subject, input.activeForm);
		return label === null ? null : [...steps, { label, state: "pending" }];
	}
	if (toolName !== TASK_UPDATE_TOOL) {
		return null;
	}
	const index = taskIndex(input.taskId);
	const state = TASK_STATE[String(input.status)];
	if (index === null || state === undefined || index >= steps.length) {
		return null;
	}
	return steps.map((step, at) => (at === index ? { ...step, state } : step));
}

function taskIndex(taskId: unknown): number | null {
	const parsed = Number.parseInt(String(taskId), 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed - 1 : null;
}

function firstNonEmptyString(...candidates: unknown[]): string | null {
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate !== "") {
			return candidate;
		}
	}
	return null;
}
