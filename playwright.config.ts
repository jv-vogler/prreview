import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "e2e",
	// the suite exercises the BUILT artifact, so it always builds first
	globalSetup: "./e2e/globalSetup.ts",
});
