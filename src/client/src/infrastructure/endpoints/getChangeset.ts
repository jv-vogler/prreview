import {
	type ChangesetDto,
	type ChangesetRefreshDto,
	changesetDtoSchema,
	changesetRefreshDtoSchema,
} from "@dto/ChangesetDto";
import type { ApiClient } from "../httpClients/apiClient";

/** `GET /api/changeset`, validated at the boundary. */
export async function getChangeset(api: ApiClient): Promise<ChangesetDto> {
	return changesetDtoSchema.parse(await api.get("/api/changeset"));
}

/**
 * `POST /api/changeset/refresh`, validated at the boundary: the changeset
 * resolved from git again, with the review status read against it.
 */
export async function refreshChangeset(
	api: ApiClient,
): Promise<ChangesetRefreshDto> {
	return changesetRefreshDtoSchema.parse(
		await api.post("/api/changeset/refresh"),
	);
}
