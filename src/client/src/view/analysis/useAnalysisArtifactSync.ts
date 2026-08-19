import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useClientContainer } from "../app/ClientContainerProvider";
import { SESSION_QUERY_KEY } from "../session/useGuaranteedSession";
import { UNDERSTANDING_QUERY_KEY } from "../understanding/useUnderstanding";

/**
 * Refetches the comprehension artifact when the server says it landed.
 *
 * The trigger is `understanding.updated` rather than a succeeded run, because
 * the event names the thing that changed: a run can succeed having produced
 * nothing a tab renders, and a future producer of the same artifact would
 * otherwise have to remember to announce itself as the right stage.
 *
 * The session is refetched alongside it, because whether an artifact exists is
 * the server's answer and never something the client infers from having
 * watched a run finish (REQ-008).
 */
export function useAnalysisArtifactSync(): void {
	const { events } = useClientContainer();
	const queryClient = useQueryClient();

	useEffect(
		() =>
			events.subscribe("understanding.updated", () => {
				for (const queryKey of [SESSION_QUERY_KEY, UNDERSTANDING_QUERY_KEY]) {
					void queryClient.invalidateQueries({ queryKey });
				}
			}),
		[events, queryClient],
	);
}
