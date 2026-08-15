export type KeyAction =
	| "next-file"
	| "prev-file"
	| "next-hunk"
	| "prev-hunk"
	| "mark-hunk-reviewed"
	| "mark-file-reviewed"
	| "toggle-diff-style"
	| "open-help";

export interface KeyContext {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	/** true when the event target is an input, textarea, select, or contenteditable */
	targetIsEditable: boolean;
	/** true while any dialog is open — the dialog owns the keyboard then */
	dialogOpen: boolean;
}

/** The M1 keymap (ARCHITECTURE §9), exactly TASK-050's table. */
const KEYMAP: Record<string, KeyAction> = {
	j: "next-file",
	k: "prev-file",
	n: "next-hunk",
	p: "prev-hunk",
	v: "mark-hunk-reviewed",
	m: "mark-file-reviewed",
	s: "toggle-diff-style",
	"?": "open-help",
};

/**
 * Pure keymap dispatch: a key event either names one review action or
 * nothing. Suppressed inside inputs and dialogs, and whenever a modifier is
 * held (shift excluded — `?` needs it).
 */
export function resolveKeyAction(context: KeyContext): KeyAction | null {
	if (context.ctrlKey || context.metaKey || context.altKey) {
		return null;
	}
	if (context.targetIsEditable || context.dialogOpen) {
		return null;
	}
	return KEYMAP[context.key] ?? null;
}
