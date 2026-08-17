/** `2.1.233 (Claude Code)` → `2.1.233`; the whole trimmed line when it has no token. */
const VERSION_TOKEN = /\d+\.\d+[^\s]*/;

/**
 * The version string of an agent CLI's `--version` output. Shared by the boot
 * probe (ARCHITECTURE §3) and the engine adapter's own `probe()`, so both
 * report the same string for the same binary.
 */
export function parseAgentVersion(output: string): string {
	return output.match(VERSION_TOKEN)?.[0] ?? output.trim();
}
