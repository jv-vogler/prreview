/**
 * A non-2xx `/api` response, carrying the server's ErrorDto fields. `reason`
 * is the machine-readable half of the wire contract — views switch on it,
 * never on message text (frontend:architecture error policy).
 */
export class HttpError extends Error {
	readonly status: number;
	readonly reason: string;
	/**
	 * The raw parsed body, kept because not every negative answer is an
	 * ErrorDto: `POST /api/analysis`'s 409 adds `existingRunId`, which the
	 * ErrorDto shape would drop. Endpoint functions that expect such a body
	 * validate it themselves; nothing else looks at it.
	 */
	readonly body: unknown;

	constructor(status: number, reason: string, message: string, body?: unknown) {
		super(message);
		this.name = "HttpError";
		this.status = status;
		this.reason = reason;
		this.body = body;
	}
}
