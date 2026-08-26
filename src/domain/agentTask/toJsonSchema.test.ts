import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { taskSchemas } from "./taskSchemas";
import { assertSchemaFitsArgv, toJsonSchema } from "./toJsonSchema";

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

	it("carries the defect/question split into the schema the CLI validates", () => {
		const findings = JSON.parse(toJsonSchema(taskSchemas.review)).properties
			.findings;
		const ajv = new Ajv({ strict: false });
		const findingIsValid = ajv.compile(findings.items);
		const base = {
			path: "src/a.ts",
			startLine: 1,
			endLine: 1,
			title: "t",
			body: "b",
			proof: "Inferred: x",
			verified: false,
			lane: "review",
		};
		expect(findingIsValid({ ...base, kind: "defect", tier: "nitpick" })).toBe(
			true,
		);
		expect(findingIsValid({ ...base, kind: "question" })).toBe(true);
		expect(findingIsValid({ ...base, kind: "defect" })).toBe(false);
		expect(findingIsValid({ ...base, kind: "question", tier: "nitpick" })).toBe(
			false,
		);
	});

	it("throws once a schema is over the argv-safe budget", () => {
		expect(() => assertSchemaFitsArgv("x".repeat(90_000))).toThrow(
			/argv budget/,
		);
	});
});
