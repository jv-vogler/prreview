import type { AnnotationOpsPost } from "@dto/AnnotationOpsPost";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { postAnnotationOps } from "../../infrastructure/endpoints/postAnnotationOps";
import { useClientContainer } from "../app/ClientContainerProvider";

export interface AnnotationOpsState {
	apply(ops: AnnotationOpsPost["ops"]): void;
	pending: boolean;
	/** what the server refused, in its words — shown, never swallowed */
	rejections: { handle: string; reason: string }[];
	clearRejections(): void;
}

/**
 * Sends edits and surfaces what came back.
 *
 * Applied changes arrive as `annotation.upserted` events and patch the cache
 * through the existing subscription, so nothing is refetched here. Rejections
 * do not arrive that way — they are the answer to this request and have to be
 * held and rendered, or an op that did nothing looks like one that worked.
 */
export function useAnnotationOps(): AnnotationOpsState {
	const { api } = useClientContainer();
	const [rejections, setRejections] = useState<
		{ handle: string; reason: string }[]
	>([]);

	const mutation = useMutation({
		mutationFn: (ops: AnnotationOpsPost["ops"]) =>
			postAnnotationOps(api, { ops }),
		onSuccess: (result) => setRejections(result.rejected),
	});

	return {
		apply: (ops) => mutation.mutate(ops),
		pending: mutation.isPending,
		rejections,
		clearRejections: () => setRejections([]),
	};
}
