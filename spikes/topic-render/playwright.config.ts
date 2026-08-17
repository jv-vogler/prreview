import { defineConfig } from "@playwright/test";

const SPIKE_PORT = 4992;

export default defineConfig({
	testDir: "./e2e",
	timeout: 120_000,
	use: {
		baseURL: `http://127.0.0.1:${SPIKE_PORT}`,
	},
	webServer: {
		command: `SPIKE_PORT=${SPIKE_PORT} node serve.mjs`,
		url: `http://127.0.0.1:${SPIKE_PORT}`,
		reuseExistingServer: true,
	},
});
