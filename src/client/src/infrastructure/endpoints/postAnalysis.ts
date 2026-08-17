import type { AnalysisRequest } from "@dto/AnalysisRequest";
import { runAcceptedDtoSchema, runConflictDtoSchema } from "@dto/RunDto";
import { parseLogged } from "../endpoints-helpers/parseLogged";
import type { ApiClient } from "../httpClients/apiClient";
import { HttpError } from "../httpClients/HttpError";

const CONFLICT = 409;

/**
 * Asking for an analysis has two ordinary answers: it was queued, or one is
 * already running and the server names it so the UI can offer "cancel and
 * re-run". The 409 body is deliberately not an ErrorDto (it adds
 * `existingRunId`), so it is read off the thrown error's raw body here rather
 * than surfacing as a failure to the caller.
 */
export type AnalysisStart =
	| { kind: "accepted"; runId: string }
	| { kind: "conflict"; existingRunId: string; message: string };

export async function postAnalysis(
	api: ApiClient,
	request: AnalysisRequest,
): Promise<AnalysisStart> {
	try {
		const data = await api.post("/api/analysis", request);
		const accepted = parseLogged(
			runAcceptedDtoSchema,
			data,
			"POST /api/analysis",
		);
		return { kind: "accepted", runId: accepted.runId };
	} catch (error) {
		if (!(error instanceof HttpError) || error.status !== CONFLICT) {
			throw error;
		}
		const conflict = runConflictDtoSchema.safeParse(error.body);
		if (!conflict.success) {
			throw error;
		}
		return {
			kind: "conflict",
			existingRunId: conflict.data.existingRunId,
			message: conflict.data.message,
		};
	}
}
