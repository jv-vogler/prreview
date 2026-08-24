import { describe, expect, it } from "vitest";
import { reviewPassSchema, storedReviewPassSchema } from "./reviewSchema";

const BARE_PASS = {
	overview: "x",
	verdict: "x",
	ticket: null,
	findings: [],
};

function explanation(overrides: Record<string, unknown> = {}) {
	return {
		path: "src/a.ts",
		startLine: 1,
		endLine: 1,
		says: ["One short sentence."],
		...overrides,
	};
}

describe("reviewPassSchema explanations", () => {
	it("defaults to an empty array, so a pass written before they existed parses", () => {
		expect(reviewPassSchema.parse(BARE_PASS).explanations).toEqual([]);
		expect(storedReviewPassSchema.parse(BARE_PASS).explanations).toEqual([]);
	});

	it("accepts an explanation with and without a topic", () => {
		const parsed = reviewPassSchema.parse({
			...BARE_PASS,
			explanations: [
				explanation({ topic: "config TTL" }),
				explanation({ says: ["Alone.", "Two sentences."] }),
			],
		});
		expect(parsed.explanations).toHaveLength(2);
		expect(parsed.explanations[0].topic).toBe("config TTL");
		expect(parsed.explanations[1].topic).toBeUndefined();
	});

	it("requires at least one says sentence — that is shape, not budget", () => {
		const withEmptySays = {
			...BARE_PASS,
			explanations: [explanation({ says: [] })],
		};
		expect(reviewPassSchema.safeParse(withEmptySays).success).toBe(false);
		expect(storedReviewPassSchema.safeParse(withEmptySays).success).toBe(false);
	});

	it("holds the engine to the says budgets, but not a pass already on disk", () => {
		const overBudget = {
			...BARE_PASS,
			explanations: [explanation({ says: ["x".repeat(200), "a", "b", "c"] })],
		};
		expect(reviewPassSchema.safeParse(overBudget).success).toBe(false);
		expect(storedReviewPassSchema.safeParse(overBudget).success).toBe(true);
	});
});
