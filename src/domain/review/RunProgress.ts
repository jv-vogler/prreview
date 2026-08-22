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
	/** when the last move was observed: empty on the client's stall clock */
	lastActivityAt: string;
}

export type RunProgressUpdate = { kind: "activity"; activity: string };

export const EMPTY_RUN_PROGRESS: RunProgress = {
	activity: null,
	toolCalls: 0,
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
		case "TodoWrite":
			return "Planning its next steps";
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

/** Folds one update into a run's progress. */
export function applyRunProgress(
	current: RunProgress,
	update: RunProgressUpdate,
	at: string,
): RunProgress {
	return {
		...current,
		activity: update.activity,
		toolCalls: current.toolCalls + 1,
		lastActivityAt: at,
	};
}
