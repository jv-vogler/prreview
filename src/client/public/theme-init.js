// Pre-paint theme application. Loaded as a blocking classic script from
// index.html <head> so the attributes exist before first paint — the
// ThemeProvider takes over after hydration and keeps them live.
// Kept in plain JS with zero imports; the logic is mirrored by
// src/view/styling/theme.ts, which owns the canonical implementation.
(function initTheme() {
	var STORAGE_KEY = "prreview.themeMode";
	var stored = null;
	try {
		stored = window.localStorage.getItem(STORAGE_KEY);
	} catch (_error) {
		// storage blocked: fall through to auto
	}
	var mode =
		stored === "light" || stored === "dark" || stored === "auto"
			? stored
			: "auto";
	var systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
	var resolved = mode === "auto" ? (systemDark ? "dark" : "light") : mode;
	var root = document.documentElement;
	root.setAttribute("data-color-mode", mode);
	root.setAttribute("data-light-theme", "light");
	root.setAttribute("data-dark-theme", "dark");
	root.setAttribute("data-resolved-theme", resolved);
})();
