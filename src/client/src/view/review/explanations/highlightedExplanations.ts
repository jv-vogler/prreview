import { createContext, useContext } from "react";

const NONE: ReadonlySet<string> = new Set();

/**
 * Which explanations are highlighted, by id — a whole topic's, or a single
 * one jumped to from the sidebar. A context rather than a prop through the
 * diff renderer: Pierre caches a file's rendered record — annotations
 * included — until its version counter moves, but mounted context consumers
 * re-render on a context change regardless, so a highlight never has to
 * invalidate the rendered diff (which would also reset every chip's fold
 * state).
 */
export const HighlightedExplanationsContext =
	createContext<ReadonlySet<string>>(NONE);

export function useHighlightedExplanations(): ReadonlySet<string> {
	return useContext(HighlightedExplanationsContext);
}
