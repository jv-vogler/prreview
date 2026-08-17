import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Annotation } from "../../domain/annotation/Annotation";
import { toAnnotation } from "../../domain/annotation/toAnnotation";
import { useClientContainer } from "../app/ClientContainerProvider";
import { ANNOTATIONS_QUERY_KEY } from "./useAnnotations";

/**
 * Explanations land one at a time while a run is still going, so the cache is
 * patched per event rather than refetched (ARCHITECTURE §9): a run producing
 * sixty notes would otherwise mean sixty round trips to learn what the events
 * already carried.
 */
export function useAnnotationEvents(): void {
	const { events } = useClientContainer();
	const queryClient = useQueryClient();

	useEffect(() => {
		const patch = (
			change: (current: readonly Annotation[]) => readonly Annotation[],
		) => {
			queryClient.setQueryData<readonly Annotation[]>(
				ANNOTATIONS_QUERY_KEY,
				(current) => change(current ?? []),
			);
		};
		const unsubscribeUpserted = events.subscribe(
			"annotation.upserted",
			(event) => {
				patch((current) => upsert(current, toAnnotation(event.annotation)));
			},
		);
		const unsubscribeRemoved = events.subscribe(
			"annotation.removed",
			(event) => {
				patch((current) =>
					current.filter((annotation) => annotation.id !== event.id),
				);
			},
		);
		return () => {
			unsubscribeUpserted();
			unsubscribeRemoved();
		};
	}, [events, queryClient]);
}

/** replace in place when the id is known, append otherwise: order is the server's */
function upsert(
	current: readonly Annotation[],
	annotation: Annotation,
): readonly Annotation[] {
	const index = current.findIndex((known) => known.id === annotation.id);
	if (index === -1) {
		return [...current, annotation];
	}
	return current.map((known, at) => (at === index ? annotation : known));
}
