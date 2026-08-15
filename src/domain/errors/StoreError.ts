import { AppError } from "./AppError";

export type StoreErrorReason =
	| "locked"
	| "schema-newer-than-binary"
	| "corrupt";

export class StoreError extends AppError {
	override readonly reason: StoreErrorReason;

	constructor(
		reason: StoreErrorReason,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.reason = reason;
	}
}
