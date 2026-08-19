/**
 * What a run is doing right now, phrased the way a person would say it.
 *
 * This type exists because a run showing no progress is indistinguishable from
 * a run that has hung, and those two need different reactions from the reader.
 * prreview already knows the agent just read `src/api/users.ts` — the
 * information was arriving on the stream and being thrown away, while the
 * screen said "Running…" for eight minutes. Saying nothing is what made a slow
 * tool feel like a broken one.
 */
export interface RunProgress {
	/** the current move, in the reader's words; null before the agent's first */
	activity: string | null;
	/** tool calls so far — the number that proves the run is alive */
	toolCalls: number;
	/** when the last move was observed: zero on the client's stall clock */
	lastActivityAt: string;
	/** a fan-out's finished children, when this run has children */
	partsDone?: number;
	partsTotal?: number;
}

/** what the lane's job tells the manager between the queue and the result */
export type RunProgressUpdate =
	| { kind: "activity"; activity: string }
	| { kind: "parts"; done: number; total: number };

export const EMPTY_RUN_PROGRESS: RunProgress = {
	activity: null,
	toolCalls: 0,
	lastActivityAt: "",
};

/**
 * A tool call as a sentence.
 *
 * Deliberately concrete: "Reading src/domain/review/adjudicate.ts" tells the
 * reader the agent is working through their code, which is the one thing a
 * spinner cannot say. Unknown tools fall back to their own name rather than to
 * a generic "working" — a name the reader can look up beats a reassurance.
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
		case "TodoWrite":
			return "Planning its next steps";
		case "Task":
			return "Delegating a sub-task";
		case "WebFetch":
		case "WebSearch":
			return "Looking something up";
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

/**
 * Folds one update into a run's progress.
 *
 * `toolCalls` counts activity reports only, so a fan-out reporting its
 * children's completion never inflates the number that is supposed to mean
 * "the agent touched something".
 */
export function applyRunProgress(
	current: RunProgress,
	update: RunProgressUpdate,
	at: string,
): RunProgress {
	if (update.kind === "parts") {
		return {
			...current,
			partsDone: update.done,
			partsTotal: update.total,
			lastActivityAt: at,
		};
	}
	return {
		...current,
		activity: update.activity,
		toolCalls: current.toolCalls + 1,
		lastActivityAt: at,
	};
}
