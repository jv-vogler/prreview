import { z } from "zod";

const ARGV_SAFE_SCHEMA_BYTES = 85_000;

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
			`inline --json-schema is ${bytes} bytes, over the ${ARGV_SAFE_SCHEMA_BYTES}-byte argv budget`,
		);
	}
}
