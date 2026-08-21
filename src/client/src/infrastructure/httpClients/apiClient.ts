import { errorDtoSchema } from "@dto/ErrorDto";
import { HttpError } from "./HttpError";

export interface ApiClient {
	get(path: string): Promise<unknown>;
	put(path: string, body: unknown): Promise<unknown>;
	post(path: string, body?: unknown): Promise<unknown>;
}

const NO_CONTENT = 204;
/** No answer at all — the request never reached a server. */
const NO_RESPONSE = 0;

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
	};
}

/**
 * A request that never got an answer, said in the same shape as one that got a
 * bad answer.
 *
 * fetch rejects with a bare TypeError when the server is gone, which carries
 * no status and matches nothing a view switches on. Left alone it reaches a
 * suspending query as an unrecognisable throw — and, worse, a proxy that holds
 * the socket open instead of refusing it never rejects at all, which is how the
 * dev server used to sit on "Loading review…" forever with the real reason
 * (no server) printed in another terminal. Every failure leaves this layer as
 * an HttpError, and `unreachable` is the one reason that is ours rather than
 * the wire's.
 */
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
			return fallback;
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
