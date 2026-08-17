import type { ToolchainDto } from "@dto/SessionDto";
import type { FeatureFlags } from "./FeatureFlags";

/**
 * What the UI may offer, decided by the agent the server actually found
 * (ARCHITECTURE §9, REQ-004). Every AI surface hangs off one fact: an
 * authenticated `claude` on PATH. With `kind: 'none'` all three flags are
 * false and the app is the viewer it was before this milestone — the surfaces
 * are absent rather than disabled, and the single ViewerOnlyNotice is the only
 * place their absence is explained.
 *
 * Capability, not availability: a flag says the app CAN analyse, chat, and
 * walk through a change, not that an analysis has run yet. Whether an artifact
 * exists is `SessionDto.analysis`, read where it is needed.
 */
export function deriveFeatureFlags(toolchain: ToolchainDto): FeatureFlags {
	const agentAvailable = toolchain.agent.kind === "claude";
	return {
		analysis: agentAvailable,
		chat: agentAvailable,
		walkthrough: agentAvailable,
	};
}
