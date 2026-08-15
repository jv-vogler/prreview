import { createRoot } from "react-dom/client";

// Placeholder shell so the client build target works from Phase 1.
// The real application (four layers, diff workspace) lands in Phase 7.
const rootElement = document.getElementById("root");
if (rootElement === null) {
	throw new Error("index.html is missing the #root element");
}

createRoot(rootElement).render(
	<p>prreview: scaffold placeholder — the viewer arrives in a later phase</p>,
);
