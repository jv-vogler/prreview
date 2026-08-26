import type { Toolchain } from "./Toolchain";

export interface FeatureFlags {
	aiAvailable: boolean;
	githubAvailable: boolean;
}

export function deriveFeatureFlags(toolchain: Toolchain): FeatureFlags {
	return {
		aiAvailable: toolchain.agent.kind === "claude",

		githubAvailable: toolchain.github.kind === "gh",
	};
}
