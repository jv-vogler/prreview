import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ANNOTATIONS_QUERY_KEY } from "../annotations/useAnnotations";
import { useClientContainer } from "../app/ClientContainerProvider";
import { SESSION_QUERY_KEY } from "../session/useGuaranteedSession";
import { REVIEW_SUMMARY_QUERY_KEY } from "./useReviewSummary";

/**
 * Refetches what a findings pass produced when the server says it landed.
 *
 * The server has published `findings.updated` since the pass shipped and **no
 * client code listened**, so `session.analysis.findingsAvailable` never
 * refreshed after a run and the discard record was never read at all. The
 * mirror of `useAnalysisArtifactSync`, and for the same reason: whether an
 * artifact exists is the server's answer, never something the client infers
 * from having watched a run finish (REQ-008).
 *
 * The annotations themselves arrive as `annotation.upserted` patches rather than
 * through this refetch — they are keyed here too, because a pass that replaces
 * a previous round's findings removes some and the cache should not be left
 * deciding which patches it missed.
 */
export function useFindingsArtifactSync(): void {
	const { events } = useClientContainer();
	const queryClient = useQueryClient();

	useEffect(
		() =>
			events.subscribe("findings.updated", () => {
				for (const queryKey of [
					SESSION_QUERY_KEY,
					REVIEW_SUMMARY_QUERY_KEY,
					ANNOTATIONS_QUERY_KEY,
				]) {
					void queryClient.invalidateQueries({ queryKey });
				}
			}),
		[events, queryClient],
	);
}
