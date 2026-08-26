import { AppError } from "./AppError";

export class ValidationError extends AppError {
	override readonly reason = "validation";
}
