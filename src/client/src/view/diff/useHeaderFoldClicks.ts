import { type RefObject, useEffect } from "react";

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

function fileIdOf(header: HTMLElement): string | null {
	const root = header.getRootNode();
	const host = root instanceof ShadowRoot ? root.host : null;
	const chevron = host?.querySelector("[data-file-fold]");
	return chevron?.getAttribute("data-file-fold") ?? null;
}
