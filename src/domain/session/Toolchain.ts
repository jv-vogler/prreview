/**
 * What the boot-time probe found on this machine (ARCHITECTURE §3). Frozen
 * into the session manifest; nothing re-checks mid-run. Lives in the domain
 * because SessionManifest embeds it and the domain is import-closed — the
 * probe that produces it is infrastructure (arrives in Phase 4).
 */
export type Toolchain = {
	agent: { kind: "claude"; version: string } | { kind: "none" };
	/** best available GitHub backend */
	github: { kind: "gh" } | { kind: "git-remote" } | { kind: "none" };
};
