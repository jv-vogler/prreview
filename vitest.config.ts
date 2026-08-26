import { fileURLToPath } from "node:url";
import { defaultExclude, defineConfig } from "vitest/config";

const CLIENT_ALIAS = {
	"@dto": fileURLToPath(new URL("./src/interface/http/dto", import.meta.url)),
};

const CLIENT_DOMAIN = "src/client/src/domain";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"src/**/*.test.{ts,tsx}",
				"src/client/src/main.tsx",
				"src/client/src/vite-env.d.ts",
			],
			thresholds: {
				statements: 74,
				branches: 65,
				functions: 71,
				lines: 74,
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
				resolve: { alias: CLIENT_ALIAS },
				test: {
					name: "client-domain",
					environment: "node",
					include: [`${CLIENT_DOMAIN}/**/*.test.ts`],
				},
			},
			{
				resolve: { alias: CLIENT_ALIAS },
				test: {
					name: "client",
					environment: "jsdom",
					include: ["src/client/**/*.test.{ts,tsx}"],
					exclude: [...defaultExclude, `${CLIENT_DOMAIN}/**`],
					setupFiles: ["./test/setup/reactTestingLibrary.ts"],
				},
			},
		],
	},
});
