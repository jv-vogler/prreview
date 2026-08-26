export interface RunProgress {
	activity: string | null;
	toolCalls: number;
	itinerary: readonly ItineraryStep[] | null;
	lastActivityAt: string;
}

export interface ItineraryStep {
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

export const TASK_CREATE_TOOL = "TaskCreate";
export const TASK_UPDATE_TOOL = "TaskUpdate";

const planning = () => "Planning its next steps";
const lookUp = (subject: string) =>
	subject === "" ? "Looking something up" : `Looking up${subject}`;

const ACTIVITY_BY_TOOL: Record<string, (subject: string) => string> = {
	Read: (subject) => `Reading${subject === "" ? " a file" : subject}`,
	Grep: (subject) => `Searching for${subject === "" ? " something" : subject}`,
	Glob: (subject) =>
		`Looking for files${subject === "" ? "" : ` matching${subject}`}`,
	Bash: (subject) => `Running a command${subject === "" ? "" : `:${subject}`}`,
	Write: (subject) => `Writing${subject === "" ? " a file" : subject}`,
	Edit: (subject) => `Editing${subject === "" ? " a file" : subject}`,
	[TASK_CREATE_TOOL]: planning,
	[TASK_UPDATE_TOOL]: planning,
	TaskList: planning,
	TaskGet: planning,
	WebFetch: lookUp,
	WebSearch: lookUp,
};

export function describeToolActivity(name: string, target?: string): string {
	const subject = target === undefined ? "" : ` ${shorten(target)}`;
	const phrase = ACTIVITY_BY_TOOL[name];
	return phrase === undefined ? `Using ${name}${subject}` : phrase(subject);
}

const MAX_TARGET_CHARS = 72;

function shorten(target: string): string {
	if (target.length <= MAX_TARGET_CHARS) {
		return target;
	}
	return `…${target.slice(-(MAX_TARGET_CHARS - 1))}`;
}

export function applyRunProgress(
	current: RunProgress,
	update: RunProgressUpdate,
	at: string,
): RunProgress {
	if (update.kind === "itinerary") {
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
