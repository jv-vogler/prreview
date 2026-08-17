import { z } from "zod";

/**
 * CON-005 (spike 4): `--json-schema` takes an inline JSON string only — no
 * file, no `@file`. 85KB inline is proven safe; the hard ceiling is the OS
 * argv limit (~128KB per argument), so every task schema is asserted under
 * the safe budget at build time (a colocated test), never in a user's run.
 */
const ARGV_SAFE_SCHEMA_BYTES = 85_000;

/** the inline JSON Schema string handed to `--json-schema` */
export function toJsonSchema(schema: z.ZodType): string {
	return JSON.stringify(z.toJSONSchema(schema, { target: "draft-2020-12" }));
}

export function assertSchemaFitsArgv(json: string): void {
	const bytes = Buffer.byteLength(json, "utf8");
	if (bytes > ARGV_SAFE_SCHEMA_BYTES) {
		throw new Error(
			`inline --json-schema is ${bytes} bytes, over the ${ARGV_SAFE_SCHEMA_BYTES}-byte argv budget (CON-005)`,
		);
	}
}
