/**
 * A non-2xx `/api` response, carrying the server's ErrorDto fields. `reason`
 * is the machine-readable half of the wire contract — views switch on it,
 * never on message text.
 */
export class HttpError extends Error {
	readonly status: number;
	readonly reason: string;
	/** the raw parsed body, kept for endpoints whose error shape adds fields */
	readonly body: unknown;

	constructor(status: number, reason: string, message: string, body?: unknown) {
		super(message);
		this.name = "HttpError";
		this.status = status;
		this.reason = reason;
		this.body = body;
	}
}
