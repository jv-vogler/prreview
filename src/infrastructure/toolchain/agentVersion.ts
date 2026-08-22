/** `2.1.239 (Claude Code)` → `2.1.239`; the whole trimmed line when it has no token. */
const VERSION_TOKEN = /\d+\.\d+[^\s]*/;

/**
 * The version string of an agent CLI's `--version` output. Shared by the
 * boot probe and the engine adapter's own `probe()`, so both report the same
 * string for the same binary.
 */
export function parseAgentVersion(output: string): string {
	return output.match(VERSION_TOKEN)?.[0] ?? output.trim();
}
