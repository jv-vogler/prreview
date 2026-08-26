import { defineConfig } from "tsdown";

export default defineConfig({
	entry: { cli: "src/interface/cli/index.ts" },
	outDir: "dist",
	format: "esm",
	platform: "node",
	fixedExtension: false,
	banner: { js: "#!/usr/bin/env node" },
	clean: ["dist/cli.js"],
});
