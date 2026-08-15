import type { SessionDto } from "@dto/SessionDto";
import { sessionDtoSchema } from "@dto/SessionDto";
import { parseLogged } from "../endpoints-helpers/parseLogged";
import type { ApiClient } from "../httpClients/apiClient";

export async function getSession(api: ApiClient): Promise<SessionDto> {
	const data = await api.get("/api/session");
	return parseLogged(sessionDtoSchema, data, "GET /api/session");
}
