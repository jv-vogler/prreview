import type { IntentMapDto } from "@dto/IntentMapDto";
import { intentMapDtoSchema } from "@dto/IntentMapDto";
import { nullWhenNotProduced } from "../endpoints-helpers/nullWhenNotProduced";
import { parseLogged } from "../endpoints-helpers/parseLogged";
import type { ApiClient } from "../httpClients/apiClient";

/** `null` until stage A has run (see nullWhenNotProduced). */
export function getIntentMap(api: ApiClient): Promise<IntentMapDto | null> {
	return nullWhenNotProduced(async () => {
		const data = await api.get("/api/intent-map");
		return parseLogged(intentMapDtoSchema, data, "GET /api/intent-map");
	});
}
