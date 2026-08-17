import { registerCustomCSSVariableTheme } from "@pierre/diffs";
import { createRoot } from "react-dom/client";
import { Root } from "./App";
import { Probe } from "./Probe";
import "./theme.css";
import "./spike.css";

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

window.addEventListener("error", (event) => {
	window.__spike.pageErrors.push(String(event.message));
});

const container = document.getElementById("root");
if (container === null) {
	throw new Error("missing #root");
}
const useProbe = new URLSearchParams(window.location.search).has("probe");
createRoot(container).render(useProbe ? <Probe /> : <Root />);
