import { reviewOutputSchema } from "../pass/ReviewPass";

/**
 * Every schema this codebase ever hands to `--json-schema`, in one place.
 * TEST-001 walks this registry through a real Ajv 8 `validateSchema` — the
 * gate whose absence once broke every run while the suite stayed green
 * (CON-002).
 */
export const taskSchemas = {
	review: reviewOutputSchema,
} as const;
