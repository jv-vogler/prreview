export interface AgentInfo {
	kind: "claude";
	version: string;
}

export type Toolchain = {
	agent: AgentInfo | { kind: "none" };
	github: { kind: "gh" } | { kind: "git-remote" } | { kind: "none" };
};
