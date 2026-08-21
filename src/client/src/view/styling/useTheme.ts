import { useContext } from "react";
import type { ThemeContextValue } from "./ThemeProvider";
import { ThemeContext } from "./ThemeProvider";

export function useTheme(): ThemeContextValue {
	const context = useContext(ThemeContext);
	if (context === null) {
		throw new Error("useTheme must be used inside a ThemeProvider");
	}
	return context;
}
