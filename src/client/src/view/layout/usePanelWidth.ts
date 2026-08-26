import { useCallback, useState } from "react";

/**
 * How wide a side panel is, remembered per device.
 *
 * A device preference, so localStorage rather than server state: how wide
 * someone likes a panel on this screen has nothing to do with which change
 * they are reviewing. One spec per panel, because the two panels hold
 * different things and neither's stops are guesses about the other's.
 */

export interface PanelWidthSpec {
	storageKey: string;
	default: number;
	/** below this the panel is a stripe with unreadable content in it */
	min: number;
	/** above this the diff, which is the actual subject, starts losing columns */
	max: number;
	/** which edge the panel is docked to; the resizer reads it for its direction */
	side: "left" | "right";
	/** what the resize handle announces */
	label: string;
}

export const FILE_PANEL: PanelWidthSpec = {
	storageKey: "prreview.sidebarWidth",
	default: 340,
	min: 200,
	max: 640,
	side: "left",
	label: "Resize the file panel",
};

export const REVIEW_PANEL: PanelWidthSpec = {
	storageKey: "prreview.reviewPanelWidth",
	default: 340,
	// comment bodies are prose: narrower than this and every one of them
	// becomes a column of two-word lines
	min: 260,
	max: 720,
	side: "right",
	label: "Resize the review panel",
};

export function clampPanelWidth(spec: PanelWidthSpec, width: number): number {
	return Math.min(spec.max, Math.max(spec.min, width));
}

function readStoredWidth(spec: PanelWidthSpec): number {
	try {
		const stored = Number(window.localStorage.getItem(spec.storageKey));
		return Number.isFinite(stored) && stored > 0
			? clampPanelWidth(spec, stored)
			: spec.default;
	} catch {
		return spec.default;
	}
}

export interface PanelWidth {
	width: number;
	setWidth(width: number): void;
}

export function usePanelWidth(spec: PanelWidthSpec): PanelWidth {
	const [width, setWidthState] = useState<number>(() => readStoredWidth(spec));

	const setWidth = useCallback(
		(next: number) => {
			const clamped = clampPanelWidth(spec, next);
			setWidthState(clamped);
			try {
				window.localStorage.setItem(
					spec.storageKey,
					String(Math.round(clamped)),
				);
			} catch {
				// storage blocked: the drag still applies for this page's lifetime
			}
		},
		[spec],
	);

	return { width, setWidth };
}
