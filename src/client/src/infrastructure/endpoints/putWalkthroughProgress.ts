import type {
	WalkthroughProgressPut,
	WalkthroughProgressResponse,
} from "@dto/WalkthroughProgressPut";
import { walkthroughProgressResponseSchema } from "@dto/WalkthroughProgressPut";
import { parseLogged } from "../endpoints-helpers/parseLogged";
import type { ApiClient } from "../httpClients/apiClient";

/**
 * Records the step being entered. The response carries the fresh coverage
 * summary the step's hunks moved, so the ring is never computed in the browser
 * (REQ-008).
 */
export async function putWalkthroughProgress(
	api: ApiClient,
	progress: WalkthroughProgressPut,
): Promise<WalkthroughProgressResponse> {
	const data = await api.put("/api/walkthrough/progress", progress);
	return parseLogged(
		walkthroughProgressResponseSchema,
		data,
		"PUT /api/walkthrough/progress",
	);
}
