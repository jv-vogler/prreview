/**
 * Base of the whole error taxonomy: anything may throw one, but only the
 * edges (HTTP onError, CLI boot) catch. `reason` is machine-readable and part
 * of the wire contract; matching on message text is banned.
 */
export abstract class AppError extends Error {
	abstract readonly reason: string;

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = new.target.name;
	}
}
