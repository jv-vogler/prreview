import type { BlobRequest } from "@dto/BlobRequest";
import type { BlobResponse } from "@dto/BlobResponse";
import { blobResponseSchema } from "@dto/BlobResponse";
import { parseLogged } from "../endpoints-helpers/parseLogged";
import type { ApiClient } from "../httpClients/apiClient";

export async function getBlob(
	api: ApiClient,
	request: BlobRequest,
): Promise<BlobResponse> {
	const query = new URLSearchParams({ ref: request.ref, path: request.path });
	const data = await api.get(`/api/blob?${query}`);
	return parseLogged(blobResponseSchema, data, "GET /api/blob");
}
