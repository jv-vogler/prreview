import { defineConfig } from "tsdown";

export default defineConfig({
	entry: { cli: "src/interface/cli/index.ts" },
	outDir: "dist",
	format: "esm",
	platform: "node",
	// package.json "type" is module, so this keeps the output named cli.js instead of cli.mjs
	fixedExtension: false,
	banner: { js: "#!/usr/bin/env node" },
	// Clean only tsdown's own artifact so dist/client/ (built by Vite) survives
	clean: ["dist/cli.js"],
});
