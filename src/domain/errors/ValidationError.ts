import { AppError } from "./AppError";

/**
 * A request that fails its zod schema at the HTTP boundary (CON-004): the
 * onError edge maps it to 400 with reason `validation`. Single fixed reason —
 * what failed is the message; clients only need to know it was their input.
 */
export class ValidationError extends AppError {
	override readonly reason = "validation";
}
