import {
	type ChangesetDto,
	type ChangesetRefreshDto,
	changesetDtoSchema,
	changesetRefreshDtoSchema,
} from "@dto/ChangesetDto";
import type { ApiClient } from "../httpClients/apiClient";

export async function getChangeset(api: ApiClient): Promise<ChangesetDto> {
	return changesetDtoSchema.parse(await api.get("/api/changeset"));
}

export async function refreshChangeset(
	api: ApiClient,
): Promise<ChangesetRefreshDto> {
	return changesetRefreshDtoSchema.parse(
		await api.post("/api/changeset/refresh"),
	);
}
