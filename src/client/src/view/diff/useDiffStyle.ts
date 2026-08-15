import { useCallback, useState } from "react";

export type DiffStyle = "unified" | "split";

const DIFF_STYLE_STORAGE_KEY = "prreview.diffStyle";

function readStoredDiffStyle(): DiffStyle {
	try {
		const stored = window.localStorage.getItem(DIFF_STYLE_STORAGE_KEY);
		return stored === "split" ? "split" : "unified";
	} catch {
		return "unified";
	}
}

/** Split/unified is a device preference, so it lives in localStorage (ARCHITECTURE §9). */
export function useDiffStyle(): [DiffStyle, () => void] {
	const [diffStyle, setDiffStyle] = useState<DiffStyle>(readStoredDiffStyle);
	const toggle = useCallback(() => {
		setDiffStyle((current) => {
			const next = current === "unified" ? "split" : "unified";
			try {
				window.localStorage.setItem(DIFF_STYLE_STORAGE_KEY, next);
			} catch {
				// storage blocked: the toggle still applies for this page's lifetime
			}
			return next;
		});
	}, []);
	return [diffStyle, toggle];
}
