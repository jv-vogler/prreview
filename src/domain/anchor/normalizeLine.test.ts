import { describe, expect, it } from "vitest";
import { normalizeLine } from "./normalizeLine";

describe("normalizeLine", () => {
	it("strips a trailing CR", () => {
		expect(normalizeLine("const total = 1;\r")).toBe("const total = 1;");
	});

	it("trims trailing whitespace", () => {
		expect(normalizeLine("return value;   ")).toBe("return value;");
		expect(normalizeLine("return value;\t \r")).toBe("return value;");
	});

	it("collapses internal whitespace runs to one space", () => {
		expect(normalizeLine("const  x   =\t\t1;")).toBe("const x = 1;");
	});

	it("removes leading whitespace so indentation-only edits compare equal", () => {
		expect(normalizeLine("    return value;")).toBe(
			normalizeLine("\t\treturn value;"),
		);
		expect(normalizeLine("return value;")).toBe(
			normalizeLine("        return value;"),
		);
	});

	it("leaves an already-normalized line alone", () => {
		expect(normalizeLine("const x = 1;")).toBe("const x = 1;");
	});

	it("normalizes a whitespace-only line to empty", () => {
		expect(normalizeLine(" \t \r")).toBe("");
		expect(normalizeLine("")).toBe("");
	});
});
