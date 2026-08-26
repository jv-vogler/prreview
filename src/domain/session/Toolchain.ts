export type Toolchain = {
	agent: { kind: "claude"; version: string } | { kind: "none" };
	github: { kind: "gh" } | { kind: "git-remote" } | { kind: "none" };
};
