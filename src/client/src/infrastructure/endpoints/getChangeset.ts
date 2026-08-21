import { type ChangesetDto, changesetDtoSchema } from "@dto/ChangesetDto";
import type { ApiClient } from "../httpClients/apiClient";

/** `GET /api/changeset`, validated at the boundary. */
export async function getChangeset(api: ApiClient): Promise<ChangesetDto> {
	return changesetDtoSchema.parse(await api.get("/api/changeset"));
}
