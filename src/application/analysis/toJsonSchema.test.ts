import { describe, expect, it } from "vitest";
import { comprehensionOutSchema } from "./schemas";
import { assertSchemaFitsArgv, toJsonSchema } from "./toJsonSchema";

const ARGV_SAFE_SCHEMA_BYTES = 85_000;

describe("toJsonSchema", () => {
	it("produces a draft 2020-12 JSON Schema string", () => {
		const parsed = JSON.parse(toJsonSchema(comprehensionOutSchema));
		expect(parsed.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
		expect(parsed.type).toBe("object");
	});

	it("carries the contract's constraints through the conversion", () => {
		const parsed = JSON.parse(toJsonSchema(comprehensionOutSchema));
		expect(parsed.properties.explanations.maxItems).toBe(60);
		expect(
			parsed.properties.risk.properties.hunkRisks.items.properties.score.enum,
		).toEqual([2, 3, 4, 5]);
		expect(parsed.required).toEqual([
			"intentMap",
			"walkthrough",
			"explanations",
			"risk",
		]);
		expect(parsed.additionalProperties).toBe(false);
	});
});

describe("assertSchemaFitsArgv", () => {
	// every M2 task schema: stage A comprehension is the only one
	it("passes every task schema, so an outgrown schema fails the build", () => {
		expect(() =>
			assertSchemaFitsArgv(toJsonSchema(comprehensionOutSchema)),
		).not.toThrow();
	});

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
