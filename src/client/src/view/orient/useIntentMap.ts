import type { IntentMapDto } from "@dto/IntentMapDto";
import { useQuery } from "@tanstack/react-query";
import { getIntentMap } from "../../infrastructure/endpoints/getIntentMap";
import { useClientContainer } from "../app/ClientContainerProvider";
import { useFeatureFlags } from "../session/useFeatureFlags";

export const INTENT_MAP_QUERY_KEY = ["intent-map"] as const;

export interface IntentMapResult {
	/** null means "no analysis has produced one yet", which is a state, not an error */
	intentMap: IntentMapDto | null;
	loading: boolean;
}

/**
 * What this change is for, in the agent's words. Refetched exactly once when a
 * comprehension run succeeds (`useAnalysisArtifactSync`), never polled.
 */
export function useIntentMap(): IntentMapResult {
	const { api } = useClientContainer();
	const flags = useFeatureFlags();
	const { data, isPending } = useQuery({
		queryKey: INTENT_MAP_QUERY_KEY,
		queryFn: () => getIntentMap(api),
		enabled: flags.analysis,
		staleTime: Infinity,
	});
	return {
		intentMap: data ?? null,
		loading: flags.analysis && isPending,
	};
}
