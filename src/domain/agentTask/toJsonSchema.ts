import { z } from "zod";

/**
 * CON-003: `--json-schema` takes an inline JSON string only — no file, no
 * `@file`. 85KB inline is proven safe; the hard ceiling is the OS argv limit
 * (~128KB per argument), so the schema is asserted under the safe budget at
 * build time (a colocated test), never in a user's run.
 */
const ARGV_SAFE_SCHEMA_BYTES = 85_000;

/**
 * CON-002: the CLI validates `--json-schema` with **Ajv 8 in draft-07
 * mode**, and Ajv 8 has no draft-2020-12 meta-schema registered. A schema
 * carrying `$schema: "https://json-schema.org/draft/2020-12/schema"` makes
 * `validateSchema` throw before the run starts, and the CLI reports
 *
 *   --json-schema is not a valid JSON Schema:
 *   no schema with key or ref "https://json-schema.org/draft/2020-12/schema"
 *
 * so *every* run failed at spawn. Two rules follow, and both are asserted in
 * the colocated test against a real Ajv 8:
 *
 * 1. convert at `target: "draft-7"`, not `"draft-2020-12"`;
 * 2. drop `$schema` entirely rather than emit the draft-07 URI — the value
 *    the validator resolves is then never ours to get wrong, whatever
 *    meta-schemas a future CLI happens to have registered.
 */
export function toJsonSchema(schema: z.ZodType): string {
	const { $schema, ...body } = z.toJSONSchema(schema, {
		target: "draft-7",
	}) as Record<string, unknown>;
	void $schema;
	return JSON.stringify(body);
}

export function assertSchemaFitsArgv(json: string): void {
	const bytes = Buffer.byteLength(json, "utf8");
	if (bytes > ARGV_SAFE_SCHEMA_BYTES) {
		throw new Error(
			`inline --json-schema is ${bytes} bytes, over the ${ARGV_SAFE_SCHEMA_BYTES}-byte argv budget (CON-003)`,
		);
	}
}
