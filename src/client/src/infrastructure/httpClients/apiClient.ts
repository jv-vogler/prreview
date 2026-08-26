import { errorDtoSchema } from "@dto/ErrorDto";
import { HttpError } from "./HttpError";

export interface ApiClient {
	get(path: string): Promise<unknown>;
	put(path: string, body: unknown): Promise<unknown>;
	post(path: string, body?: unknown): Promise<unknown>;
	patch(path: string, body: unknown): Promise<unknown>;
	delete(path: string): Promise<unknown>;
}

const NO_CONTENT = 204;

const NO_RESPONSE = 0;

export function createApiClient(fetchImpl: typeof fetch = fetch): ApiClient {
	async function request(
		path: string,
		init: RequestInit = {},
	): Promise<unknown> {
		const response = await fetchOrUnreachable(fetchImpl, path, init);
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
		patch: (path, body) => request(path, jsonInit("PATCH", body)),
		delete: (path) => request(path, { method: "DELETE" }),
	};
}

async function fetchOrUnreachable(
	fetchImpl: typeof fetch,
	path: string,
	init: RequestInit,
): Promise<Response> {
	try {
		return await fetchImpl(path, init);
	} catch (cause) {
		const error = new HttpError(
			NO_RESPONSE,
			"unreachable",
			`Could not reach the prreview server (${path}).`,
		);
		error.cause = cause;
		throw error;
	}
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
		const body = await response.json();
		const parsed = errorDtoSchema.safeParse(body);
		if (!parsed.success) {
			return new HttpError(
				response.status,
				fallback.reason,
				fallback.message,
				body,
			);
		}
		return new HttpError(
			response.status,
			parsed.data.reason,
			parsed.data.message,
			body,
		);
	} catch {
		return fallback;
	}
}
