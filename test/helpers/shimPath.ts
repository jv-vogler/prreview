import { access, constants, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_BIN_DIR = fileURLToPath(new URL("../bin/", import.meta.url));

/**
 * PATH values for adapter tests. Both exclude every real directory, so the
 * machine's gh and claude are unreachable no matter what is installed
 * (Phase 4 completion criterion); git stays available through a symlink.
 */
export interface PathShim {
	/** fake gh + fake claude first, then git — the "tools installed" world */
	withFakes: string;
	/** only git — the "nothing but git installed" world */
	gitOnly: string;
	dispose(): Promise<void>;
}

export async function createPathShim(): Promise<PathShim> {
	const shimDir = await mkdtemp(join(tmpdir(), "prreview-shim-"));
	await symlink(await findOnPath("git"), join(shimDir, "git"));
	// test/bin/claude is a node script: its `#!/usr/bin/env node` shebang must
	// resolve on this stripped PATH, in the withFakes and gitOnly worlds alike
	await symlink(process.execPath, join(shimDir, "node"));
	return {
		withFakes: [TEST_BIN_DIR, shimDir].join(delimiter),
		gitOnly: shimDir,
		dispose: () => rm(shimDir, { recursive: true, force: true }),
	};
}

async function findOnPath(command: string): Promise<string> {
	for (const directory of (process.env.PATH ?? "").split(delimiter)) {
		if (directory === "") {
			continue;
		}
		const candidate = join(directory, command);
		try {
			await access(candidate, constants.X_OK);
			return candidate;
		} catch {
			// keep looking
		}
	}
	throw new Error(`${command} not found on PATH`);
}
