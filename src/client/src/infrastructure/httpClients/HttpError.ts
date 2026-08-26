export class HttpError extends Error {
	readonly status: number;
	readonly reason: string;
	readonly body: unknown;

	constructor(status: number, reason: string, message: string, body?: unknown) {
		super(message);
		this.name = "HttpError";
		this.status = status;
		this.reason = reason;
		this.body = body;
	}
}
