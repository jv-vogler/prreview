import { useCallback, useState } from "react";

/**
 * How wide the file panel is, remembered per device.
 *
 * A device preference, so localStorage rather than server state: how wide
 * someone likes a panel on this screen has nothing to do with which change
 * they are reviewing.
 */

const SIDEBAR_WIDTH_STORAGE_KEY = "prreview.sidebarWidth";

export const SIDEBAR_WIDTH_DEFAULT = 340;
/** below this the paths are unreadable and the panel is just a stripe */
export const SIDEBAR_WIDTH_MIN = 200;
/** above this the diff, which is the actual subject, starts losing columns */
export const SIDEBAR_WIDTH_MAX = 640;

export function clampSidebarWidth(width: number): number {
	return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, width));
}

function readStoredWidth(): number {
	try {
		const stored = Number(
			window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY),
		);
		return Number.isFinite(stored) && stored > 0
			? clampSidebarWidth(stored)
			: SIDEBAR_WIDTH_DEFAULT;
	} catch {
		return SIDEBAR_WIDTH_DEFAULT;
	}
}

export interface SidebarWidth {
	width: number;
	setWidth(width: number): void;
}

export function useSidebarWidth(): SidebarWidth {
	const [width, setWidthState] = useState<number>(readStoredWidth);

	const setWidth = useCallback((next: number) => {
		const clamped = clampSidebarWidth(next);
		setWidthState(clamped);
		try {
			window.localStorage.setItem(
				SIDEBAR_WIDTH_STORAGE_KEY,
				String(Math.round(clamped)),
			);
		} catch {
			// storage blocked: the drag still applies for this page's lifetime
		}
	}, []);

	return { width, setWidth };
}
