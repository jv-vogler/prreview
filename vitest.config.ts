import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			include: ["src/**"],
			exclude: [
				"src/**/*.test.{ts,tsx}",
				"src/client/src/main.tsx",
				"src/client/src/vite-env.d.ts",
			],
			// a ratchet, not a target: these are the numbers the suite already
			// hits, so they can only ever be raised
			thresholds: {
				statements: 73,
				branches: 63,
				functions: 70,
				lines: 73,
			},
		},
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
				// mirror of src/client/vite.config.ts's alias so client tests
				// resolve the wire contract the same way the app does (CON-002)
				resolve: {
					alias: {
						"@dto": fileURLToPath(
							new URL("./src/interface/http/dto", import.meta.url),
						),
					},
				},
				test: {
					name: "client",
					environment: "jsdom",
					include: ["src/client/**/*.test.{ts,tsx}"],
					setupFiles: ["./test/setup/reactTestingLibrary.ts"],
				},
			},
		],
	},
});
