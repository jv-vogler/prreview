import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUILD_TIMEOUT_MS = 180_000;

export default function buildBeforeE2e(): void {
	execFileSync("npm", ["run", "build"], {
		cwd: REPO_ROOT,
		stdio: "inherit",
		timeout: BUILD_TIMEOUT_MS,
	});
}
