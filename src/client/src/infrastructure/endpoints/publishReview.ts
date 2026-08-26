import { type ReviewPassDto, reviewPassDtoSchema } from "@dto/ReviewDto";
import type { ApiClient } from "../httpClients/apiClient";

export async function publishReview(api: ApiClient): Promise<ReviewPassDto> {
	return reviewPassDtoSchema.parse(await api.post("/api/review/publish"));
}
