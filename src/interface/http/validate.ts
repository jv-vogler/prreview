import type { Context } from "hono";
import type { z } from "zod";
import { ValidationError } from "../../domain/errors/ValidationError";

/**
 * CON-004 boundary #1: request bodies are zod-validated the moment they
 * enter. Malformed JSON and schema failures both become ValidationError,
 * which the onError edge maps to 400 `validation`.
 */
export async function validatedJson<Schema extends z.ZodType>(
	context: Context,
	schema: Schema,
): Promise<z.infer<Schema>> {
	let body: unknown;
	try {
		body = await context.req.json();
	} catch (cause) {
		throw new ValidationError("The request body is not valid JSON.", {
			cause,
		});
	}
	return parsedOrValidationError(schema, body);
}

/** Same boundary for query strings. */
export function validatedQuery<Schema extends z.ZodType>(
	context: Context,
	schema: Schema,
): z.infer<Schema> {
	return parsedOrValidationError(schema, context.req.query());
}

function parsedOrValidationError<Schema extends z.ZodType>(
	schema: Schema,
	value: unknown,
): z.infer<Schema> {
	const result = schema.safeParse(value);
	if (!result.success) {
		throw new ValidationError(summarizeIssues(result.error), {
			cause: result.error,
		});
	}
	return result.data;
}

function summarizeIssues(error: z.ZodError): string {
	return error.issues
		.map((issue) => {
			const path = issue.path.join(".");
			return path === "" ? issue.message : `${path}: ${issue.message}`;
		})
		.join("; ");
}
