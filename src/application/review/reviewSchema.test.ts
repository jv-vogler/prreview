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

function finding(overrides: Record<string, unknown> = {}) {
	return {
		path: "src/a.ts",
		startLine: 1,
		endLine: 1,
		tier: "nitpick",
		title: "t",
		body: "b",
		proof: "Inferred: x",
		verified: false,
		lane: "review",
		...overrides,
	};
}

describe("reviewPassSchema findings", () => {
	it("reads a finding with no kind as a defect, so a stored pass still parses", () => {
		const pass = { ...BARE_PASS, findings: [finding()] };
		expect(reviewPassSchema.parse(pass).findings[0].kind).toBe("defect");
		expect(storedReviewPassSchema.parse(pass).findings[0].kind).toBe("defect");
	});

	it("accepts a question with no tier", () => {
		const pass = {
			...BARE_PASS,
			findings: [finding({ kind: "question", tier: undefined })],
		};
		expect(reviewPassSchema.parse(pass).findings[0]).not.toHaveProperty("tier");
		expect(storedReviewPassSchema.safeParse(pass).success).toBe(true);
	});

	it("rejects a defect with no tier: the ladder is what a defect is placed on", () => {
		const untieredDefect = {
			...BARE_PASS,
			findings: [finding({ tier: undefined })],
		};
		expect(reviewPassSchema.safeParse(untieredDefect).success).toBe(false);
		expect(storedReviewPassSchema.safeParse(untieredDefect).success).toBe(
			false,
		);
	});

	// dropping the stray field beats discarding a finished pass over it
	it("drops a tier a question should never have carried", () => {
		const parsed = reviewPassSchema.parse({
			...BARE_PASS,
			findings: [finding({ kind: "question" })],
		});
		expect(parsed.findings[0]).not.toHaveProperty("tier");
	});
});

describe("reviewPassSchema explanation grounding", () => {
	it("defaults to inferred, the honest reading of a pass that never said", () => {
		const pass = { ...BARE_PASS, explanations: [explanation()] };
		expect(reviewPassSchema.parse(pass).explanations[0].grounding).toBe(
			"inferred",
		);
		expect(storedReviewPassSchema.parse(pass).explanations[0].grounding).toBe(
			"inferred",
		);
	});

	it("keeps `code` when the reason was actually read", () => {
		const parsed = reviewPassSchema.parse({
			...BARE_PASS,
			explanations: [explanation({ grounding: "code" })],
		});
		expect(parsed.explanations[0].grounding).toBe("code");
	});
});
