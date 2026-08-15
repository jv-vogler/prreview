import type { ServerEvents } from "./events/eventSource";
import { createServerEvents } from "./events/eventSource";
import type { ApiClient } from "./httpClients/apiClient";
import { createApiClient } from "./httpClients/apiClient";

export interface ClientContainer {
	api: ApiClient;
	events: ServerEvents;
}

/**
 * The client-side composition root (ARCHITECTURE §9, §2's pattern at small
 * scale): built once in main.tsx, provided to the view through context, and
 * replaced wholesale by fakes in tests — never module-mocked (PAT-001).
 */
export function buildClientContainer(): ClientContainer {
	return {
		api: createApiClient(),
		events: createServerEvents(),
	};
}
