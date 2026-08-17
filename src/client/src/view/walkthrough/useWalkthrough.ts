import type { WalkthroughDto } from "@dto/WalkthroughDto";
import { useQuery } from "@tanstack/react-query";
import { getWalkthrough } from "../../infrastructure/endpoints/getWalkthrough";
import { useClientContainer } from "../app/ClientContainerProvider";
import { useFeatureFlags } from "../session/useFeatureFlags";

export const WALKTHROUGH_QUERY_KEY = ["walkthrough"] as const;

export interface WalkthroughResult {
	/** null means "no analysis has produced one yet", which is a state, not an error */
	walkthrough: WalkthroughDto | null;
	loading: boolean;
}

/**
 * The guided reading order. Refetched exactly once when a comprehension run
 * succeeds (`useAnalysisArtifactSync`), never polled.
 */
export function useWalkthrough(): WalkthroughResult {
	const { api } = useClientContainer();
	const flags = useFeatureFlags();
	const { data, isPending } = useQuery({
		queryKey: WALKTHROUGH_QUERY_KEY,
		queryFn: () => getWalkthrough(api),
		enabled: flags.walkthrough,
		staleTime: Infinity,
	});
	return {
		walkthrough: data ?? null,
		loading: flags.walkthrough && isPending,
	};
}
