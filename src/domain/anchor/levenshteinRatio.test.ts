import { describe, expect, it } from "vitest";
import { levenshteinRatio } from "./levenshteinRatio";

describe("levenshteinRatio", () => {
	it("is 1 for identical strings", () => {
		expect(levenshteinRatio("const x = 1;", "const x = 1;")).toBe(1);
	});

	it("is 1 for two empty strings", () => {
		expect(levenshteinRatio("", "")).toBe(1);
	});

	it("is 0 when one side is empty", () => {
		expect(levenshteinRatio("abc", "")).toBe(0);
		expect(levenshteinRatio("", "abc")).toBe(0);
	});

	it("matches the classic kitten/sitting distance of 3", () => {
		expect(levenshteinRatio("kitten", "sitting")).toBeCloseTo(1 - 3 / 7, 10);
	});

	it("is symmetric", () => {
		expect(levenshteinRatio("saturday", "sunday")).toBe(
			levenshteinRatio("sunday", "saturday"),
		);
	});

	it("stays above 0.9 for a one-character edit of a code line", () => {
		const original = "const total = price * quantity;";
		const edited = "const total = price * quantityX;";
		expect(levenshteinRatio(original, edited)).toBeGreaterThanOrEqual(0.9);
	});

	it("falls below 0.9 for an unrelated line", () => {
		expect(levenshteinRatio("const total = 1;", "// filler")).toBeLessThan(0.9);
	});
});
