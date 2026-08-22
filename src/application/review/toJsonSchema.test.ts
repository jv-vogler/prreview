import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { taskSchemas } from "./taskSchemas";
import { assertSchemaFitsArgv, toJsonSchema } from "./toJsonSchema";

/**
 * TEST-001: this is the test whose absence once broke every run while the
 * suite stayed green (CON-002) — every schema registered for
 * `--json-schema` must survive the exact validator the real CLI uses.
 */
describe("toJsonSchema", () => {
	it("drops $schema so no meta-schema URI has to resolve", () => {
		const json = toJsonSchema(taskSchemas.review);
		expect(JSON.parse(json)).not.toHaveProperty("$schema");
	});

	it.each(Object.entries(taskSchemas))(
		"emits a schema Ajv 8 accepts in draft-07 mode: %s",
		(_name, schema) => {
			const json = toJsonSchema(schema);
			const ajv = new Ajv({ strict: false });
			const parsed = JSON.parse(json);
			expect(ajv.validateSchema(parsed)).toBe(true);
		},
	);

	it.each(Object.entries(taskSchemas))(
		"fits the argv-safe schema budget: %s",
		(_name, schema) => {
			expect(() => assertSchemaFitsArgv(toJsonSchema(schema))).not.toThrow();
		},
	);

	it("throws once a schema is over the argv-safe budget", () => {
		expect(() => assertSchemaFitsArgv("x".repeat(90_000))).toThrow(
			/argv budget/,
		);
	});
});
