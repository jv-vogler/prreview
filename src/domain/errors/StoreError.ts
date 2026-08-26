import { AppError } from "./AppError";

export type StoreErrorReason = "locked" | "corrupt";

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
