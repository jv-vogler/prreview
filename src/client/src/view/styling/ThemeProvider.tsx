import type { ReactNode } from "react";
import { createContext, useEffect, useMemo, useState } from "react";
import type { ResolvedTheme, ThemeMode } from "./theme";
import {
	applyThemeAttributes,
	nextThemeMode,
	parseThemeMode,
	resolveTheme,
	THEME_MODE_STORAGE_KEY,
} from "./theme";

export interface ThemeContextValue {
	mode: ThemeMode;
	resolvedTheme: ResolvedTheme;
	cycleThemeMode(): void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function readStoredMode(): ThemeMode {
	try {
		return parseThemeMode(window.localStorage.getItem(THEME_MODE_STORAGE_KEY));
	} catch {
		return "auto";
	}
}

function persistMode(mode: ThemeMode): void {
	try {
		window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
	} catch {
		// storage blocked: the mode still applies for this page's lifetime
	}
}

export interface ThemeProviderProps {
	children: ReactNode;
}

/**
 * Owns the live theme state after the pre-paint script (public/theme-init.js)
 * has already stamped the initial attributes: keeps the root attributes in
 * sync with the picked mode, tracks the OS preference through matchMedia
 * while in `auto`, and persists mode changes to localStorage.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
	const [mode, setMode] = useState<ThemeMode>(readStoredMode);
	const [systemPrefersDark, setSystemPrefersDark] = useState(
		() => window.matchMedia(DARK_SCHEME_QUERY).matches,
	);

	useEffect(() => {
		const mediaQuery = window.matchMedia(DARK_SCHEME_QUERY);
		const onChange = (event: MediaQueryListEvent) => {
			setSystemPrefersDark(event.matches);
		};
		mediaQuery.addEventListener("change", onChange);
		return () => mediaQuery.removeEventListener("change", onChange);
	}, []);

	const resolvedTheme = resolveTheme(mode, systemPrefersDark);

	useEffect(() => {
		applyThemeAttributes(document.documentElement, mode, resolvedTheme);
	}, [mode, resolvedTheme]);

	const value = useMemo<ThemeContextValue>(
		() => ({
			mode,
			resolvedTheme,
			cycleThemeMode: () => {
				setMode((current) => {
					const next = nextThemeMode(current);
					persistMode(next);
					return next;
				});
			},
		}),
		[mode, resolvedTheme],
	);

	return (
		<ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
	);
}
