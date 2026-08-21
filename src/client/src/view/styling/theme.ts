/**
 * Theme model: the user picks a mode (light, dark, or auto), the provider
 * resolves `auto` against the OS preference, and the root element carries
 * Primer's scheme attributes plus our computed `data-resolved-theme` so our
 * CSS keys off one concrete attribute.
 *
 * public/theme-init.js mirrors this logic for the pre-paint pass; keep the
 * storage key and attribute names in sync with it.
 */

export type ThemeMode = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

export const THEME_MODE_STORAGE_KEY = "prreview.themeMode";

const THEME_MODE_CYCLE: Record<ThemeMode, ThemeMode> = {
	light: "dark",
	dark: "auto",
	auto: "light",
};

export function nextThemeMode(mode: ThemeMode): ThemeMode {
	return THEME_MODE_CYCLE[mode];
}

export function resolveTheme(
	mode: ThemeMode,
	systemPrefersDark: boolean,
): ResolvedTheme {
	if (mode === "auto") {
		return systemPrefersDark ? "dark" : "light";
	}
	return mode;
}

export function parseThemeMode(stored: string | null): ThemeMode {
	if (stored === "light" || stored === "dark" || stored === "auto") {
		return stored;
	}
	return "auto";
}

export function applyThemeAttributes(
	root: HTMLElement,
	mode: ThemeMode,
	resolved: ResolvedTheme,
): void {
	root.setAttribute("data-color-mode", mode);
	root.setAttribute("data-light-theme", "light");
	root.setAttribute("data-dark-theme", "dark");
	root.setAttribute("data-resolved-theme", resolved);
}
