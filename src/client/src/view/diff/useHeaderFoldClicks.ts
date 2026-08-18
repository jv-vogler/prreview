import { type RefObject, useEffect } from "react";

/**
 * Makes the whole file header fold its file, not just the chevron.
 *
 * Why this is a DOM listener rather than a prop: the renderer draws its header
 * inside a shadow root and offers no click hook for it, only slots to render
 * content into. A composed event still crosses the boundary, so one delegated
 * listener on the view's own container sees every header click and
 * `composedPath()` reports the shadow nodes it passed through. That is the
 * whole trick — no header is reached into, nothing is patched, and a Pierre
 * upgrade that changes the header's internals breaks this into doing nothing
 * rather than into doing something wrong.
 *
 * Two things are deliberately not folds. A click that lands on a control —
 * the chevron, the Viewed box, a link — belongs to that control, which is why
 * the walk stops at the first interactive element it meets on the way up. And
 * a click that ends a text selection is someone copying a path, not someone
 * asking for the file to disappear.
 */
export function useHeaderFoldClicks(
	containerRef: RefObject<HTMLDivElement | null>,
	onToggleFile: (fileId: string) => void,
): void {
	useEffect(() => {
		const container = containerRef.current;
		if (container === null) {
			return;
		}

		const onClick = (event: MouseEvent) => {
			const fileId = foldTargetOf(event);
			if (fileId !== null) {
				onToggleFile(fileId);
			}
		};

		container.addEventListener("click", onClick);
		return () => container.removeEventListener("click", onClick);
	}, [containerRef, onToggleFile]);
}

/** the file a click asked to fold, or null when it asked for something else */
function foldTargetOf(event: MouseEvent): string | null {
	if (event.defaultPrevented || event.button !== 0) {
		return null;
	}
	if (document.getSelection()?.isCollapsed === false) {
		return null;
	}

	for (const node of event.composedPath()) {
		if (!(node instanceof HTMLElement)) {
			continue;
		}
		if (node.matches("button, a, input, label, select, textarea")) {
			return null;
		}
		if (node.hasAttribute("data-diffs-header")) {
			return fileIdOf(node);
		}
	}
	return null;
}

/**
 * Which file a header belongs to.
 *
 * The header itself carries no id, so the answer comes from the chevron we
 * render into it: its host element is the renderer's per-file container, and
 * the chevron is the one light-DOM child of that container that names the file.
 * A header with no chevron is a file we chose not to make foldable, and
 * returning null there is the correct answer rather than a failure.
 */
function fileIdOf(header: HTMLElement): string | null {
	const root = header.getRootNode();
	const host = root instanceof ShadowRoot ? root.host : null;
	const chevron = host?.querySelector("[data-file-fold]");
	return chevron?.getAttribute("data-file-fold") ?? null;
}
