import { useEffect } from "react";
import type { KeyAction } from "./resolveKeyAction";
import { resolveKeyAction } from "./resolveKeyAction";

export interface KeymapHandlers {
	dialogOpen: boolean;
	onAction(action: KeyAction): void;
}

/**
 * Window-level keydown wiring for the M1 keymap: normalizes the event into
 * the pure resolver's context and dispatches the named action. Editable
 * targets and open dialogs suppress everything (TASK-050).
 */
export function useKeymap({ dialogOpen, onAction }: KeymapHandlers): void {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) {
				return;
			}
			const action = resolveKeyAction({
				key: event.key,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				altKey: event.altKey,
				targetIsEditable: isEditableTarget(event.target),
				dialogOpen,
			});
			if (action === null) {
				return;
			}
			event.preventDefault();
			onAction(action);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
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
