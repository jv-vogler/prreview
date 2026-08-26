import { createContext, useContext } from "react";

export const NO_HIGHLIGHTED_EXPLANATIONS: ReadonlySet<string> = new Set();

export const HighlightedExplanationsContext = createContext<
	ReadonlySet<string>
>(NO_HIGHLIGHTED_EXPLANATIONS);

export function useHighlightedExplanations(): ReadonlySet<string> {
	return useContext(HighlightedExplanationsContext);
}
