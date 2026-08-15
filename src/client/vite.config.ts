import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_SERVER_DEFAULT_PORT = 4973;
const DEV_SERVER_PORT = 5173;

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			// The wire contract: the only server folder the client may import (see ARCHITECTURE §2)
			"@dto": fileURLToPath(new URL("../interface/http/dto", import.meta.url)),
		},
	},
	build: {
		outDir: "../../dist/client",
		emptyOutDir: true,
	},
	server: {
		port: DEV_SERVER_PORT,
		proxy: {
			"/api": `http://127.0.0.1:${API_SERVER_DEFAULT_PORT}`,
		},
	},
});
