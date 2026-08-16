import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUILD_TIMEOUT_MS = 180_000;

/**
 * The e2e suite proves the BUILT artifact (TASK-052), so every run starts
 * from a fresh `dist/` — a stale build must never produce a false green.
 */
export default function buildBeforeE2e(): void {
	execFileSync("npm", ["run", "build"], {
		cwd: REPO_ROOT,
		stdio: "inherit",
		timeout: BUILD_TIMEOUT_MS,
	});
}
