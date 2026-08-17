import { useMemo } from "react";
import { deriveFeatureFlags } from "../../domain/session/deriveFeatureFlags";
import type { FeatureFlags } from "../../domain/session/FeatureFlags";
import { useGuaranteedSession } from "./useGuaranteedSession";

/**
 * The one production caller of `deriveFeatureFlags`: every AI surface asks
 * this hook whether it exists at all (ARCHITECTURE §9, REQ-004). Below the
 * suspense gate the session is guaranteed, so the answer is never "not yet".
 */
export function useFeatureFlags(): FeatureFlags {
	const { toolchain } = useGuaranteedSession();
	return useMemo(() => deriveFeatureFlags(toolchain), [toolchain]);
}
