import { defineConfig } from "vite";
import { SSE_SERVER_PORT } from "./server.ts";

export const VITE_DEV_PORT = 4994;

/**
 * The proxy config under test: this is what the real client's vite.config.ts
 * needs for `/api` (including the SSE endpoint) to reach the local server.
 * Findings are recorded in NOTES.md.
 */
export default defineConfig({
	server: {
		port: VITE_DEV_PORT,
		strictPort: true,
		proxy: {
			"/api": {
				target: `http://127.0.0.1:${SSE_SERVER_PORT}`,
			},
		},
	},
});
