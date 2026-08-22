import type { Toolchain } from "./Toolchain";

/**
 * What the client is allowed to show, derived once from the boot-time
 * toolchain probe. REQ-009: with no `claude` on PATH, every AI surface is
 * **absent**, not disabled — there is no "Review" button rendered greyed
 * out with a tooltip explaining why it cannot be clicked.
 */
export interface FeatureFlags {
	aiAvailable: boolean;
	/** REQ-007: with no GitHub backend, publish is absent, not disabled */
	githubAvailable: boolean;
}

export function deriveFeatureFlags(toolchain: Toolchain): FeatureFlags {
	return {
		aiAvailable: toolchain.agent.kind === "claude",
		// mirrors container.ts's selectGithubService: "git-remote" has no
		// publish-capable backend yet, so it is absent here too, not just null
		githubAvailable: toolchain.github.kind === "gh",
	};
}
