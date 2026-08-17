import { describe, expect, it } from "vitest";
import { checkForm, stripFences } from "./formGate";

const rules = (body: string, anchoredLines?: string[]) =>
	checkForm({ body, anchoredLines }).map((violation) => violation.rule);

describe("checkForm", () => {
	it("passes a comment that says the consequence and shows the code", () => {
		expect(
			rules(
				"Retries here will hammer a failing endpoint: the backoff is computed but never awaited.\n\n```ts\nbackoff(attempt);\nawait send(payload);\n```",
			),
		).toEqual([]);
	});

	/**
	 * The budget is about what a person reads in a review thread, and a fenced
	 * block is scanned rather than read. Counting fences would push the model
	 * toward describing code instead of showing it.
	 */
	it("measures prose only, so a long code block is fine", () => {
		const body = `Short claim here.\n\n\`\`\`ts\n${"const x = 1;\n".repeat(80)}\`\`\``;
		expect(rules(body)).toEqual([]);
	});

	it("fails prose past the pasteable budget", () => {
		expect(
			rules(`${"This is a long sentence about the code. ".repeat(20)}`),
		).toContain("prose-too-long");
	});

	it("fails a lead that rambles past two sentences", () => {
		expect(
			rules(
				"First point about it. Second point about it. Third point about it. Fourth one too.",
			),
		).toContain("lead-too-long");
	});

	it("fails prose that reads as generated", () => {
		expect(rules("It's worth noting that this could overflow.")).toContain(
			"prose-tell",
		);
		expect(rules("Nice work! This could overflow.")).toContain("prose-tell");
	});

	it("fails a comment that just reads the code back", () => {
		expect(
			rules("The retries const is set to the maxRetries config value.", [
				"const retries = config.maxRetries;",
			]),
		).toContain("restates-code");
	});

	it("allows a comment that names the code but says what follows from it", () => {
		expect(
			rules(
				"If maxRetries is unset this silently becomes zero, so a transient failure is never retried at all.",
				["const retries = config.maxRetries;"],
			),
		).not.toContain("restates-code");
	});

	it("fails an empty body outright, and says only that", () => {
		expect(rules("   ")).toEqual(["empty"]);
	});

	it("reports every violation, not just the first", () => {
		const violations = rules(
			`It's worth noting that ${"this is a padded sentence about it. ".repeat(20)}`,
		);
		expect(violations).toContain("prose-tell");
		expect(violations).toContain("prose-too-long");
	});
});

describe("stripFences", () => {
	it("removes fenced blocks and inline code", () => {
		expect(stripFences("a `b` c\n```\nd\n```\ne")).toBe("a c e");
	});
});
