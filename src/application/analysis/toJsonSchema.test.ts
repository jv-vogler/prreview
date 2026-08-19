import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { TASK_SCHEMAS } from "./taskSchemas";
import { assertSchemaFitsArgv, toJsonSchema } from "./toJsonSchema";
import { representativeUnderstandingOutSchema } from "./understandingSchemas";

const ARGV_SAFE_SCHEMA_BYTES = 85_000;

/**
 * `ajv` is a devDependency pinned to the 8.x the CLI itself validates with, and
 * it is imported here and by `test/bin/claude` only — never by `src/` at
 * runtime. Ajv 8's default export is the draft-07 build: constructing it is
 * what makes this an honest reproduction of the CLI's own gate rather than a
 * restatement of what we hope it does.
 */
function validateAsTheCliDoes(json: string): boolean {
	return new Ajv({ strict: false }).validateSchema(JSON.parse(json)) === true;
}

describe("toJsonSchema", () => {
	it("emits no $schema at all, so no meta-schema has to resolve (CON-014)", () => {
		const parsed = JSON.parse(
			toJsonSchema(representativeUnderstandingOutSchema),
		);
		expect(parsed.$schema).toBeUndefined();
		expect(parsed.type).toBe("object");
	});

	it("carries the contract's constraints through the conversion", () => {
		const parsed = JSON.parse(
			toJsonSchema(representativeUnderstandingOutSchema),
		);
		expect(parsed.properties.topics.maxItems).toBe(10);
		expect(parsed.properties.topics.items.properties.title.maxLength).toBe(60);
		expect(parsed.properties.topics.items.properties.summary.maxLength).toBe(
			280,
		);
		/*
		 * The overview is an array of capped lines, not one capped string. The
		 * cap that matters is per line, because that is what forces a short
		 * sentence — a total budget only ever bought a shorter wall of text.
		 */
		expect(parsed.properties.summary.type).toBe("array");
		expect(parsed.properties.summary.items.maxLength).toBe(160);
		expect(parsed.properties.summary.maxItems).toBe(5);
		expect(parsed.properties.headline.maxLength).toBe(120);
		expect(parsed.required).toEqual([
			"headline",
			"summary",
			"topics",
			"suggestedEntryPoint",
			"goalMatch",
		]);
		expect(parsed.additionalProperties).toBe(false);
	});
});

/**
 * The gate this whole class of bug needed. Every registered task schema is put
 * through a real Ajv 8 draft-07 `validateSchema`, which is what the CLI does to
 * `--json-schema` before it spawns anything. Reverting `toJsonSchema` to
 * `target: "draft-2020-12"` turns these red — that is the falsifiability check.
 */
describe("the Ajv draft-07 gate over every task schema (CON-014)", () => {
	const registered = Object.entries(TASK_SCHEMAS);

	it("registers at least one task schema, so the gate is never vacuous", () => {
		expect(registered.length).toBeGreaterThan(0);
	});

	it.each(registered)("%s validates under Ajv 8 draft-07", (_name, schema) => {
		const json = toJsonSchema(schema);
		expect(() => validateAsTheCliDoes(json)).not.toThrow();
		expect(validateAsTheCliDoes(json)).toBe(true);
	});

	it("still rejects the draft-2020-12 shape that caused the outage", () => {
		const withMeta = {
			...JSON.parse(toJsonSchema(representativeUnderstandingOutSchema)),
			$schema: "https://json-schema.org/draft/2020-12/schema",
		};
		expect(() => new Ajv({ strict: false }).validateSchema(withMeta)).toThrow(
			/no schema with key or ref .*2020-12/,
		);
	});
});

describe("assertSchemaFitsArgv", () => {
	it.each(Object.entries(TASK_SCHEMAS))(
		"%s fits the argv budget, so an outgrown schema fails the build",
		(_name, schema) => {
			expect(() => assertSchemaFitsArgv(toJsonSchema(schema))).not.toThrow();
		},
	);

	it("passes at exactly the 85KB budget", () => {
		expect(() =>
			assertSchemaFitsArgv("x".repeat(ARGV_SAFE_SCHEMA_BYTES)),
		).not.toThrow();
	});

	it("throws one byte over the budget", () => {
		expect(() =>
			assertSchemaFitsArgv("x".repeat(ARGV_SAFE_SCHEMA_BYTES + 1)),
		).toThrow(/85000-byte argv budget/);
	});

	it("measures bytes, not characters", () => {
		// U+00E9 is 2 bytes in UTF-8: 43000 chars = 86000 bytes, over budget
		expect(() => assertSchemaFitsArgv("é".repeat(43_000))).toThrow(
			/argv budget/,
		);
	});
});
