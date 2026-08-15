import type { RefreshResponse } from "@dto/RefreshResponse";
import { refreshResponseSchema } from "@dto/RefreshResponse";
import { parseLogged } from "../endpoints-helpers/parseLogged";
import type { ApiClient } from "../httpClients/apiClient";

export async function postChangesetRefresh(
	api: ApiClient,
): Promise<RefreshResponse> {
	const data = await api.post("/api/changeset/refresh");
	return parseLogged(
		refreshResponseSchema,
		data,
		"POST /api/changeset/refresh",
	);
}
