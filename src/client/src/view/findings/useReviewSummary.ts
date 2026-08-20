import type { ReviewSummaryDto } from "@dto/ReviewSummaryDto";
import { useQuery } from "@tanstack/react-query";
import { getReviewSummary } from "../../infrastructure/endpoints/getReviewSummary";
import { useClientContainer } from "../app/ClientContainerProvider";
import { useFeatureFlags } from "../session/useFeatureFlags";

export const REVIEW_SUMMARY_QUERY_KEY = ["review-summary"] as const;

/**
 * What the last findings pass decided beyond the comments it produced.
 *
 * Gated on the agent flag so a viewer-only install asks for nothing (REQ-004),
 * and refetched when the server announces a pass landed rather than polled.
 */
export function useReviewSummary(): ReviewSummaryDto | null {
	const { api } = useClientContainer();
	const flags = useFeatureFlags();
	const { data } = useQuery({
		queryKey: REVIEW_SUMMARY_QUERY_KEY,
		queryFn: () => getReviewSummary(api),
		enabled: flags.analysis,
		staleTime: Infinity,
	});
	return data ?? null;
}
