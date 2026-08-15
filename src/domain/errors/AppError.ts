/**
 * Base of the whole error taxonomy (ARCHITECTURE §2): anything may throw one,
 * but only the four edges (HTTP onError, CLI boot, run manager, poller) catch.
 * `reason` is machine-readable and part of the wire contract; matching on
 * message text is banned.
 */
export abstract class AppError extends Error {
	abstract readonly reason: string;

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = new.target.name;
	}
}
