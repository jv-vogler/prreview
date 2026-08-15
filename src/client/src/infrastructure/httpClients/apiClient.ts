import { errorDtoSchema } from "@dto/ErrorDto";
import { HttpError } from "./HttpError";

export interface ApiClient {
	get(path: string): Promise<unknown>;
	put(path: string, body: unknown): Promise<unknown>;
	post(path: string, body?: unknown): Promise<unknown>;
}

const NO_CONTENT = 204;

/**
 * The one fetch wrapper (ARCHITECTURE §9): same-origin JSON in/out, non-2xx
 * parsed as ErrorDto and thrown as HttpError. Endpoint functions own response
 * validation; this layer only moves bytes.
 */
export function createApiClient(fetchImpl: typeof fetch = fetch): ApiClient {
	async function request(
		path: string,
		init: RequestInit = {},
	): Promise<unknown> {
		const response = await fetchImpl(path, init);
		if (!response.ok) {
			throw await toHttpError(response);
		}
		if (response.status === NO_CONTENT) {
			return undefined;
		}
		return response.json();
	}

	return {
		get: (path) => request(path),
		put: (path, body) => request(path, jsonInit("PUT", body)),
		post: (path, body) => request(path, jsonInit("POST", body)),
	};
}

function jsonInit(method: string, body: unknown): RequestInit {
	if (body === undefined) {
		return { method };
	}
	return {
		method,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	};
}

async function toHttpError(response: Response): Promise<HttpError> {
	const fallback = new HttpError(
		response.status,
		"internal",
		`Request failed with status ${response.status}.`,
	);
	try {
		const parsed = errorDtoSchema.safeParse(await response.json());
		if (!parsed.success) {
			return fallback;
		}
		return new HttpError(
			response.status,
			parsed.data.reason,
			parsed.data.message,
		);
	} catch {
		return fallback;
	}
}
