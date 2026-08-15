import type { ChangesetDto } from "@dto/ChangesetDto";
import { changesetDtoSchema } from "@dto/ChangesetDto";
import { parseLogged } from "../endpoints-helpers/parseLogged";
import type { ApiClient } from "../httpClients/apiClient";

export async function getChangeset(api: ApiClient): Promise<ChangesetDto> {
	const data = await api.get("/api/changeset");
	return parseLogged(changesetDtoSchema, data, "GET /api/changeset");
}
