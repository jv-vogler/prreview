import type { WalkthroughDto } from "@dto/WalkthroughDto";
import { useQuery } from "@tanstack/react-query";
import { getWalkthrough } from "../../infrastructure/endpoints/getWalkthrough";
import { useClientContainer } from "../app/ClientContainerProvider";
import { useFeatureFlags } from "../session/useFeatureFlags";
import { useGuaranteedSession } from "../session/useGuaranteedSession";

export const WALKTHROUGH_QUERY_KEY = ["walkthrough"] as const;

export interface WalkthroughResult {
	/** null means "no analysis has produced one yet", which is a state, not an error */
	walkthrough: WalkthroughDto | null;
	loading: boolean;
}

/**
 * The guided reading order. Refetched exactly once when a comprehension run
 * succeeds (`useAnalysisArtifactSync`), never polled.
 *
 * Asked for only when the session says one exists: the flag says whether this
 * session can ever have a walkthrough, `analysis.walkthroughAvailable` says
 * whether it has one right now, and asking before then earns a designed 404 on
 * every page load — a request that can only fail is not a request worth making.
 */
export function useWalkthrough(): WalkthroughResult {
	const { api } = useClientContainer();
	const flags = useFeatureFlags();
	const session = useGuaranteedSession();
	const produced = flags.walkthrough && session.analysis.walkthroughAvailable;
	const { data, isPending } = useQuery({
		queryKey: WALKTHROUGH_QUERY_KEY,
		queryFn: () => getWalkthrough(api),
		enabled: produced,
		staleTime: Infinity,
	});
	return {
		walkthrough: data ?? null,
		loading: produced && isPending,
	};
}
