import { type ReviewPassDto, reviewPassDtoSchema } from "@dto/ReviewDto";
import type { ApiClient } from "../httpClients/apiClient";

/** `POST /api/review/publish` (TASK-050); answers the recomputed pass. */
export async function publishReview(api: ApiClient): Promise<ReviewPassDto> {
	return reviewPassDtoSchema.parse(await api.post("/api/review/publish"));
}
