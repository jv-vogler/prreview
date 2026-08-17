import type { WalkthroughDto } from "@dto/WalkthroughDto";
import { walkthroughDtoSchema } from "@dto/WalkthroughDto";
import { nullWhenNotProduced } from "../endpoints-helpers/nullWhenNotProduced";
import { parseLogged } from "../endpoints-helpers/parseLogged";
import type { ApiClient } from "../httpClients/apiClient";

/** `null` until stage A has run (see nullWhenNotProduced). */
export function getWalkthrough(api: ApiClient): Promise<WalkthroughDto | null> {
	return nullWhenNotProduced(async () => {
		const data = await api.get("/api/walkthrough");
		return parseLogged(walkthroughDtoSchema, data, "GET /api/walkthrough");
	});
}
