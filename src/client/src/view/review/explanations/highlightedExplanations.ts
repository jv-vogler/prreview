import { createContext, useContext } from "react";

const NONE: ReadonlySet<string> = new Set();

export const HighlightedExplanationsContext =
	createContext<ReadonlySet<string>>(NONE);

export function useHighlightedExplanations(): ReadonlySet<string> {
	return useContext(HighlightedExplanationsContext);
}
