import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useClientContainer } from "../app/ClientContainerProvider";
import { INTENT_MAP_QUERY_KEY } from "../orient/useIntentMap";
import { SESSION_QUERY_KEY } from "../session/useGuaranteedSession";
import { WALKTHROUGH_QUERY_KEY } from "../walkthrough/useWalkthrough";

/** the analysis-lane task whose result is an intent map and a walkthrough */
const COMPREHENSION_STAGE = "comprehension";

/**
 * A succeeded comprehension run is the one moment those two artifacts come
 * into existence, so it is the one moment they are fetched. Annotations are not
 * refetched here — they arrived as `annotation.upserted` events while the run
 * was still going. The session is refetched with them because whether an
 * artifact exists is the server's answer, not something the client infers from
 * having seen a run succeed (REQ-008).
 */
export function useAnalysisArtifactSync(): void {
	const { events } = useClientContainer();
	const queryClient = useQueryClient();

	useEffect(
		() =>
			events.subscribe("run.succeeded", (event) => {
				if (event.run.stage !== COMPREHENSION_STAGE) {
					return;
				}
				for (const queryKey of [
					SESSION_QUERY_KEY,
					INTENT_MAP_QUERY_KEY,
					WALKTHROUGH_QUERY_KEY,
				]) {
					void queryClient.invalidateQueries({ queryKey });
				}
			}),
		[events, queryClient],
	);
}
