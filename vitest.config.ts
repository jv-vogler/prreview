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
					include: ["src/**/*.test.ts", "test/**/*.test.ts"],
					exclude: ["src/client/**"],
				},
			},
			{
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
