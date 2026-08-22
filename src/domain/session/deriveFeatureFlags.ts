import type { Toolchain } from "./Toolchain";

/**
 * What the client is allowed to show, derived once from the boot-time
 * toolchain probe. REQ-009: with no `claude` on PATH, every AI surface is
 * **absent**, not disabled — there is no "Review" button rendered greyed
 * out with a tooltip explaining why it cannot be clicked.
 */
export interface FeatureFlags {
	aiAvailable: boolean;
}

export function deriveFeatureFlags(toolchain: Toolchain): FeatureFlags {
	return { aiAvailable: toolchain.agent.kind === "claude" };
}
