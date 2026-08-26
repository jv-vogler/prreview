import { AppError } from "./AppError";

export type ValidationErrorReason = "validation";

export class ValidationError extends AppError {
	override readonly reason: ValidationErrorReason = "validation";
}
