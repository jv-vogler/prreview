import type { UnderstandingDto } from "@dto/TopicDto";
import { useQuery } from "@tanstack/react-query";
import { getUnderstanding } from "../../infrastructure/endpoints/getUnderstanding";
import { useClientContainer } from "../app/ClientContainerProvider";
import { useFeatureFlags } from "../session/useFeatureFlags";

export const UNDERSTANDING_QUERY_KEY = ["understanding"] as const;

export interface UnderstandingResult {
	/** null means no pass has produced one yet — a state, not an error */
	understanding: UnderstandingDto | null;
	loading: boolean;
}

/**
 * What the comprehension pass understood: the topics the Understanding tab
 * renders and the orientation the Overview tab renders, from one run.
 *
 * Gated on the agent flag, so a viewer-only install requests nothing at all
 * (REQ-004) rather than asking an endpoint that would answer a designed 404 on
 * every page load. Refetched when the server announces the artifact landed
 * (`useAnalysisArtifactSync`), never polled.
 */
export function useUnderstanding(): UnderstandingResult {
	const { api } = useClientContainer();
	const flags = useFeatureFlags();
	const { data, isPending } = useQuery({
		queryKey: UNDERSTANDING_QUERY_KEY,
		queryFn: () => getUnderstanding(api),
		enabled: flags.analysis,
		staleTime: Infinity,
	});
	return {
		understanding: data ?? null,
		loading: flags.analysis && isPending,
	};
}
