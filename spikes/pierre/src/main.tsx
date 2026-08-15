import { registerCustomCSSVariableTheme } from "@pierre/diffs";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";

/**
 * Register a CSS-variable theme once, before first render. Defaults mirror the
 * light palette; the live values come from theme.css so a data-attribute flip
 * can retheme without re-rendering (the cascade-vs-snapshot question).
 */
registerCustomCSSVariableTheme("spike-vars", {
	foreground: "#1f2328",
	background: "#ffffff",
	"token-constant": "#0550ae",
	"token-string": "#0a3069",
	"token-comment": "#57606a",
	"token-keyword": "#cf222e",
	"token-parameter": "#953800",
	"token-function": "#8250df",
	"token-string-expression": "#0a3069",
	"token-punctuation": "#1f2328",
	"token-link": "#0a3069",
});

document.documentElement.dataset.spikeTheme = "light";

const container = document.getElementById("root");
if (container === null) {
	throw new Error("missing #root");
}
createRoot(container).render(<App />);
