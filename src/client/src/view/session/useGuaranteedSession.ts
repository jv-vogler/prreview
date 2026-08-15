import type { SessionDto } from "@dto/SessionDto";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getSession } from "../../infrastructure/endpoints/getSession";
import { useClientContainer } from "../app/ClientContainerProvider";

export const SESSION_QUERY_KEY = ["session"] as const;

/**
 * The session below the app shell's suspense gate (TASK-049): the query
 * suspends until data exists, so consumers always hold a real SessionDto.
 * SSE events patch this cache via setQueryData; it never refetches on its
 * own (REQ-007 — the server pushes, the client does not poll).
 */
export function useGuaranteedSession(): SessionDto {
	const { api } = useClientContainer();
	const { data } = useSuspenseQuery({
		queryKey: SESSION_QUERY_KEY,
		queryFn: () => getSession(api),
		staleTime: Infinity,
	});
	return data;
}
