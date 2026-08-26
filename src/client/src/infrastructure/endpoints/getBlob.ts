import type { BlobRequest } from "@dto/BlobRequest";
import { type BlobResponse, blobResponseSchema } from "@dto/BlobResponse";
import type { ApiClient } from "../httpClients/apiClient";

export async function getBlob(
	api: ApiClient,
	request: BlobRequest,
): Promise<BlobResponse> {
	const query = new URLSearchParams(request).toString();
	return blobResponseSchema.parse(await api.get(`/api/blob?${query}`));
}
