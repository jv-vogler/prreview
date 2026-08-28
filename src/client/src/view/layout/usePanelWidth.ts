import { useCallback, useState } from "react";

export interface PanelWidthSpec {
	storageKey: string;
	default: number;
	min: number;
	max: number;
	side: "left" | "right";
	label: string;
	title: string;
}

export const FILE_PANEL: PanelWidthSpec = {
	storageKey: "prreview.sidebarWidth",
	default: 340,
	min: 200,
	max: 640,
	side: "left",
	label: "Resize the file panel",
	title: "file",
};

export const REVIEW_PANEL: PanelWidthSpec = {
	storageKey: "prreview.reviewPanelWidth",
	default: 340,

	min: 260,
	max: 720,
	side: "right",
	label: "Resize the review panel",
	title: "review",
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
			} catch {}
		},
		[spec],
	);

	return { width, setWidth };
}

function foldStorageKey(spec: PanelWidthSpec): string {
	return `${spec.storageKey}.folded`;
}

function readStoredFold(spec: PanelWidthSpec): boolean {
	try {
		return window.localStorage.getItem(foldStorageKey(spec)) === "true";
	} catch {
		return false;
	}
}

export interface PanelFold {
	folded: boolean;
	toggle(): void;
}

export function usePanelFold(spec: PanelWidthSpec): PanelFold {
	const [folded, setFoldedState] = useState<boolean>(() =>
		readStoredFold(spec),
	);

	const toggle = useCallback(() => {
		setFoldedState((current) => {
			const next = !current;
			try {
				window.localStorage.setItem(foldStorageKey(spec), String(next));
			} catch {}
			return next;
		});
	}, [spec]);

	return { folded, toggle };
}
