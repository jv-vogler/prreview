import { defineConfig } from "@playwright/test";

const SPIKE_PORT = 4991;

export default defineConfig({
	testDir: "./e2e",
	timeout: 60_000,
	use: {
		baseURL: `http://127.0.0.1:${SPIKE_PORT}`,
	},
	webServer: {
		command: "node serve.mjs",
		url: `http://127.0.0.1:${SPIKE_PORT}`,
		reuseExistingServer: true,
	},
});
