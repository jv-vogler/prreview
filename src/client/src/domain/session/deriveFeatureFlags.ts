import type { ToolchainDto } from "@dto/SessionDto";
import type { FeatureFlags } from "./FeatureFlags";

/**
 * M1 ships no AI surfaces at all (ASSUMPTION-003), so every flag is false —
 * even with a claude binary present. The toolchain parameter is the M2 seam:
 * when the engine lands, flags start answering `toolchain.agent.kind`.
 */
export function deriveFeatureFlags(_toolchain: ToolchainDto): FeatureFlags {
	return {
		analysis: false,
		chat: false,
		walkthrough: false,
	};
}
