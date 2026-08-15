import { fileURLToPath } from "node:url";
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
				},
			},
		],
	},
});
