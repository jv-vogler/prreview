import type { z } from "zod";

/**
 * The log-don't-block response boundary (CON-004): schema drift between
 * client and server becomes a dev console error, never a blank screen. The
 * data flows on as-is because the server is the source of truth — the schema
 * here is a tripwire, not a gate.
 */
export function parseLogged<Schema extends z.ZodType>(
	schema: Schema,
	data: unknown,
	label: string,
): z.infer<Schema> {
	const result = schema.safeParse(data);
	if (!result.success) {
		console.error(
			`prreview: ${label} did not match the expected schema`,
			result.error,
		);
		return data as z.infer<Schema>;
	}
	return result.data;
}
