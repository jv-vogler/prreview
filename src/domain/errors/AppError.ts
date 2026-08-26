export abstract class AppError extends Error {
	abstract readonly reason: string;

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = new.target.name;
	}
}
