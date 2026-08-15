import type { SessionDto } from "@dto/SessionDto";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { postChangesetRefresh } from "../../infrastructure/endpoints/postChangesetRefresh";
import { useClientContainer } from "../app/ClientContainerProvider";
import { CHANGESET_QUERY_KEY } from "../diff/useGuaranteedChangeset";
import { SESSION_QUERY_KEY } from "./useGuaranteedSession";

export interface DriftBanner {
	driftDetected: boolean;
	refreshing: boolean;
	refresh(): void;
}

/**
 * `changeset.drifted` only raises the banner — refetching is a user action
 * (REQ-007). The refresh button POSTs `/api/changeset/refresh` and patches
 * both caches from the response: the new round's changeset and the coverage
 * summary after carry-over.
 */
export function useDriftBanner(): DriftBanner {
	const { api, events } = useClientContainer();
	const queryClient = useQueryClient();
	const [driftDetected, setDriftDetected] = useState(false);

	useEffect(
		() =>
			events.subscribe("changeset.drifted", () => {
				setDriftDetected(true);
			}),
		[events],
	);

	const mutation = useMutation({
		mutationFn: () => postChangesetRefresh(api),
		onSuccess: (response) => {
			queryClient.setQueryData(CHANGESET_QUERY_KEY, response.changeset);
			queryClient.setQueryData<SessionDto>(SESSION_QUERY_KEY, (session) =>
				session === undefined
					? session
					: { ...session, coverage: response.coverage },
			);
			setDriftDetected(false);
		},
	});

	return {
		driftDetected,
		refreshing: mutation.isPending,
		refresh: () => mutation.mutate(),
	};
}
