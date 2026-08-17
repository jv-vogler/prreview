import type { UnderstandingDto } from "@dto/TopicDto";
import { understandingDtoSchema } from "@dto/TopicDto";
import { nullWhenNotProduced } from "../endpoints-helpers/nullWhenNotProduced";
import { parseLogged } from "../endpoints-helpers/parseLogged";
import type { ApiClient } from "../httpClients/apiClient";

/**
 * `GET /api/understanding` — everything one comprehension pass produced.
 *
 * A 404 with reason `not-produced` is a state, not a failure: the tab renders
 * its invitation instead of an error, so `null` is a legitimate answer.
 */
export async function getUnderstanding(
	api: ApiClient,
): Promise<UnderstandingDto | null> {
	return nullWhenNotProduced(async () =>
		parseLogged(
			understandingDtoSchema,
			await api.get("/api/understanding"),
			"understanding",
		),
	);
}
