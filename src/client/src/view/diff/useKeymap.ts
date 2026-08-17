import { useEffect, useRef } from "react";
import type { KeyAction } from "./resolveKeyAction";
import { resolveKeyAction } from "./resolveKeyAction";

export interface KeymapHandlers {
	dialogOpen: boolean;
	onAction(action: KeyAction): void;
}

/**
 * How long a half-typed chord waits for its second key. Without a deadline a
 * stray `g` would silently swallow the next key press minutes later.
 */
const CHORD_TIMEOUT_MS = 1500;

/**
 * Window-level keydown wiring for the keymap: normalizes the event into the
 * pure resolver's context, remembers a chord prefix between two presses, and
 * dispatches the named action. Editable targets and open dialogs suppress
 * everything (ARCHITECTURE §9).
 */
export function useKeymap({ dialogOpen, onAction }: KeymapHandlers): void {
	const pendingChordRef = useRef<string | null>(null);

	useEffect(() => {
		let chordTimer: ReturnType<typeof setTimeout> | null = null;
		const clearChord = () => {
			pendingChordRef.current = null;
			if (chordTimer !== null) {
				clearTimeout(chordTimer);
				chordTimer = null;
			}
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) {
				return;
			}
			const resolution = resolveKeyAction({
				key: event.key,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				altKey: event.altKey,
				targetIsEditable: isEditableTarget(event.target),
				dialogOpen,
				pendingChord: pendingChordRef.current,
			});
			if (resolution.kind === "chord") {
				clearChord();
				pendingChordRef.current = resolution.prefix;
				chordTimer = setTimeout(clearChord, CHORD_TIMEOUT_MS);
				event.preventDefault();
				return;
			}
			const chordWasPending = pendingChordRef.current !== null;
			clearChord();
			if (resolution.kind === "none") {
				// a key that completes no chord is swallowed, not re-read as itself
				if (chordWasPending) {
					event.preventDefault();
				}
				return;
			}
			event.preventDefault();
			onAction(resolution.action);
		};

		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			clearChord();
		};
	}, [dialogOpen, onAction]);
}

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (target.isContentEditable) {
		return true;
	}
	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
