import type { ChangesetDto } from "@dto/ChangesetDto";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getChangeset } from "../../infrastructure/endpoints/getChangeset";
import { useClientContainer } from "../app/ClientContainerProvider";

export const CHANGESET_QUERY_KEY = ["changeset"] as const;

/**
 * The changeset below the suspense gate (TASK-049). Refresh responses patch
 * this cache via setQueryData; `changeset.drifted` deliberately does NOT
 * refetch it — refreshing is a user action (REQ-007).
 */
export function useGuaranteedChangeset(): ChangesetDto {
	const { api } = useClientContainer();
	const { data } = useSuspenseQuery({
		queryKey: CHANGESET_QUERY_KEY,
		queryFn: () => getChangeset(api),
		staleTime: Infinity,
	});
	return data;
}
