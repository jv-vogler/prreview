import { createContext, useContext } from "react";

/**
 * Which topic's balloons are highlighted, if any. A context rather than a
 * prop through the diff renderer: Pierre caches a file's rendered record —
 * annotations included — until its version counter moves, but mounted
 * context consumers re-render on a context change regardless, so a
 * highlight never has to invalidate the rendered diff (which would also
 * reset every chip's fold state).
 */
export const HighlightedTopicContext = createContext<string | null>(null);

export function useHighlightedTopic(): string | null {
	return useContext(HighlightedTopicContext);
}
