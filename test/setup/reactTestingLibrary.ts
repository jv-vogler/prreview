import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// `@testing-library/react`'s auto-cleanup only registers itself against a
// *global* `afterEach`, which this project does not enable (vitest.config.ts
// has no `test.globals`). Without this, a component test file with more than
// one `render()` accumulates every prior render in the jsdom document, and
// `screen.getByRole` starts finding duplicates that belong to earlier tests.
afterEach(() => {
	cleanup();
});
