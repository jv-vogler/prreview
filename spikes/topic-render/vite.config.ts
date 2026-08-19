import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	// The worker chunk must be an ES module: @pierre/diffs ships ESM workers.
	worker: { format: "es" },
	build: { target: "es2022" },
});
