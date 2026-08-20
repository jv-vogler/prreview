import { useQuery } from "@tanstack/react-query";
import type { Annotation } from "../../domain/annotation/Annotation";
import { toAnnotation } from "../../domain/annotation/toAnnotation";
import { getAnnotations } from "../../infrastructure/endpoints/getAnnotations";
import { useClientContainer } from "../app/ClientContainerProvider";
import { useFeatureFlags } from "../session/useFeatureFlags";

export const ANNOTATIONS_QUERY_KEY = ["annotations"] as const;

const NO_ANNOTATIONS: readonly Annotation[] = [];

/**
 * The round's annotations. Fetched once and then kept fresh by SSE patches
 * (`useAnnotationEvents`), never by polling. With no agent the query is never
 * issued at all: there is nothing to fetch, and the viewer floor makes no
 * request the M1 viewer did not make (REQ-004).
 */
export function useAnnotations(): readonly Annotation[] {
	return useAnnotationsQuery().annotations;
}

export interface AnnotationsResult {
	annotations: readonly Annotation[];
	/** the first fetch is still out — not the same as "there are none" */
	loading: boolean;
}

/**
 * The same query, for a surface that has to tell "none yet" from "not back yet".
 *
 * The comments tab needs the difference: an empty list is what it renders its
 * "run a review" invitation for, so during the first fetch — a reload while a
 * review is running, most obviously — it flashed that invitation at somebody
 * whose review was already in flight.
 */
export function useAnnotationsQuery(): AnnotationsResult {
	const { api } = useClientContainer();
	const flags = useFeatureFlags();
	const { data, isPending } = useQuery({
		queryKey: ANNOTATIONS_QUERY_KEY,
		queryFn: async () => (await getAnnotations(api)).map(toAnnotation),
		enabled: flags.analysis,
		staleTime: Infinity,
	});
	return {
		annotations: data ?? NO_ANNOTATIONS,
		loading: flags.analysis && isPending,
	};
}
