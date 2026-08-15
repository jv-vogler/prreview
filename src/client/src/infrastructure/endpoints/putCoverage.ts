import type { CoverageUpdateDto } from "@dto/CoveragePut";
import type { CoverageSummaryDto } from "@dto/CoverageSummaryDto";
import { coverageSummaryDtoSchema } from "@dto/CoverageSummaryDto";
import { parseLogged } from "../endpoints-helpers/parseLogged";
import type { ApiClient } from "../httpClients/apiClient";

export async function putCoverage(
	api: ApiClient,
	updates: readonly CoverageUpdateDto[],
): Promise<CoverageSummaryDto> {
	const data = await api.put("/api/coverage", { updates });
	return parseLogged(coverageSummaryDtoSchema, data, "PUT /api/coverage");
}
