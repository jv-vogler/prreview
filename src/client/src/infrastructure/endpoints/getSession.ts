import { type SessionDto, sessionDtoSchema } from "@dto/SessionDto";
import type { ApiClient } from "../httpClients/apiClient";

/** `GET /api/session`, validated at the boundary. */
export async function getSession(api: ApiClient): Promise<SessionDto> {
	return sessionDtoSchema.parse(await api.get("/api/session"));
}
