export type KeyAction =
	| "next-file"
	| "prev-file"
	| "next-hunk"
	| "prev-hunk"
	| "next-annotation"
	| "prev-annotation"
	| "mark-hunk-reviewed"
	| "mark-file-reviewed"
	| "toggle-chat"
	| "toggle-diff-style"
	| "go-diff"
	| "go-understand"
	| "go-comments"
	| "open-help";

/** the only chord prefix in the keymap: `g` for "go to" */
export const CHORD_PREFIX = "g";

export interface KeyContext {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	/** true when the event target is an input, textarea, select, or contenteditable */
	targetIsEditable: boolean;
	/** true while any dialog is open — the dialog owns the keyboard then */
	dialogOpen: boolean;
	/** the prefix already typed, when the reader is halfway through a chord */
	pendingChord: string | null;
}

/**
 * What one key press means: an action, the start of a two-key chord, or
 * nothing. Told apart explicitly because a pending chord has to swallow the
 * key press without doing anything yet.
 */
export type KeyResolution =
	| { kind: "action"; action: KeyAction }
	| { kind: "chord"; prefix: string }
	| { kind: "none" };

/** The keymap of ARCHITECTURE §9, minus the curation keys M3 adds. */
const KEYMAP: Record<string, KeyAction> = {
	j: "next-file",
	k: "prev-file",
	n: "next-hunk",
	p: "prev-hunk",
	"]": "next-annotation",
	"[": "prev-annotation",
	v: "mark-hunk-reviewed",
	m: "mark-file-reviewed",
	c: "toggle-chat",
	s: "toggle-diff-style",
	"?": "open-help",
};

/** the second half of a `g` chord, one per tab */
const CHORD_KEYMAP: Record<string, KeyAction> = {
	d: "go-diff",
	u: "go-understand",
	c: "go-comments",
};

const NOTHING: KeyResolution = { kind: "none" };

/**
 * Pure keymap dispatch. Suppressed inside inputs (the chat textarea included)
 * and dialogs, and whenever a modifier is held (shift excluded — `?` needs
 * it). A key that follows `g` is only ever read as the chord's second half:
 * `g` then `j` moves nothing, so a half-typed chord cannot fire a stray action.
 */
export function resolveKeyAction(context: KeyContext): KeyResolution {
	if (context.ctrlKey || context.metaKey || context.altKey) {
		return NOTHING;
	}
	if (context.targetIsEditable || context.dialogOpen) {
		return NOTHING;
	}
	if (context.pendingChord === CHORD_PREFIX) {
		const action = CHORD_KEYMAP[context.key];
		return action === undefined ? NOTHING : { kind: "action", action };
	}
	if (context.key === CHORD_PREFIX) {
		return { kind: "chord", prefix: CHORD_PREFIX };
	}
	const action = KEYMAP[context.key];
	return action === undefined ? NOTHING : { kind: "action", action };
}
