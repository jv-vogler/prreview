import type {
	AnnotationOpsPost,
	AnnotationOpsResult,
} from "@dto/AnnotationOpsPost";
import { annotationOpsResultSchema } from "@dto/AnnotationOpsPost";
import { parseLogged } from "../endpoints-helpers/parseLogged";
import type { ApiClient } from "../httpClients/apiClient";

/**
 * Applies edits to suggested comments through the one server-side write path.
 *
 * The result carries `rejected` as well as `applied`, and callers must show it:
 * an op that named a comment that does not exist did nothing, and letting the
 * user believe otherwise is worse than the failure.
 */
export async function postAnnotationOps(
	api: ApiClient,
	request: AnnotationOpsPost,
): Promise<AnnotationOpsResult> {
	return parseLogged(
		annotationOpsResultSchema,
		await api.post("/api/annotations/ops", request),
		"POST /api/annotations/ops",
	);
}
