import type { RunDto } from "@dto/RunDto";
import { runDtoSchema } from "@dto/RunDto";
import { z } from "zod";
import { parseLogged } from "../endpoints-helpers/parseLogged";
import type { ApiClient } from "../httpClients/apiClient";

const responseSchema = z.array(runDtoSchema);

/**
 * Every run this server process knows about, both lanes. Runs are ephemeral —
 * a restart forgets them — so this is how a page loaded mid-run learns one is
 * in flight; the DTO's `lane` says which lane it belongs to.
 */
export async function getAnalysisRuns(api: ApiClient): Promise<RunDto[]> {
	const data = await api.get("/api/analysis/runs");
	return parseLogged(responseSchema, data, "GET /api/analysis/runs");
}
