import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// The scaffold ships before the first test file (Phase 3) — keep `npm test` green until then
		passWithNoTests: true,
		projects: [
			{
				test: {
					name: "server",
					environment: "node",
					// test/ holds the cross-layer suites (hostile requests); unit
					// tests stay colocated under src/
					include: ["src/**/*.test.ts", "test/**/*.test.ts"],
					exclude: ["src/client/**"],
				},
			},
			{
				test: {
					name: "client",
					environment: "jsdom",
					include: ["src/client/**/*.test.{ts,tsx}"],
				},
			},
		],
	},
});
