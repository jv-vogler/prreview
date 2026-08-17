import type { ApiClient } from "../httpClients/apiClient";

/**
 * Stops a run. 204 with no body — the cancellation itself arrives as a
 * `run.cancelled` event, like every other run state change.
 */
export async function postCancelRun(
	api: ApiClient,
	runId: string,
): Promise<void> {
	await api.post(`/api/analysis/runs/${encodeURIComponent(runId)}/cancel`);
}
