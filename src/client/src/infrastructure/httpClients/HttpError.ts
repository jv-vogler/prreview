/**
 * A non-2xx `/api` response, carrying the server's ErrorDto fields. `reason`
 * is the machine-readable half of the wire contract — views switch on it,
 * never on message text (frontend:architecture error policy).
 */
export class HttpError extends Error {
	readonly status: number;
	readonly reason: string;

	constructor(status: number, reason: string, message: string) {
		super(message);
		this.name = "HttpError";
		this.status = status;
		this.reason = reason;
	}
}
