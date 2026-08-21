/**
 * What the boot-time probe found on this machine. Frozen into the session
 * for its lifetime; nothing re-checks mid-run. Lives in the domain because
 * it is embedded in session state and the domain is import-closed — the
 * probe that produces it is infrastructure.
 */
export type Toolchain = {
	agent: { kind: "claude"; version: string } | { kind: "none" };
	/** best available GitHub backend */
	github: { kind: "gh" } | { kind: "git-remote" } | { kind: "none" };
};
