import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_EXPLANATIONS } from "./limits";
import { type ComprehensionOut, comprehensionOutSchema } from "./schemas";

const COMPREHENSION_FIXTURE = new URL(
	"../../../test/fixtures/claude/comprehension.jsonl",
	import.meta.url,
);

/** the structured_output the real CLI produced against the captured schema */
function fixtureStructuredOutput(): unknown {
	const lines = readFileSync(COMPREHENSION_FIXTURE, "utf8").trim().split("\n");
	for (const line of lines) {
		if (line.startsWith("#")) {
			continue;
		}
		const event = JSON.parse(line);
		if (event.type === "result") {
			return event.structured_output;
		}
	}
	throw new Error("comprehension.jsonl has no result event");
}

function validSample(): ComprehensionOut {
	return {
		intentMap: {
			summary: "adds an excited mode to the greeter",
			clusters: [
				{
					name: "excited greeting",
					kind: "core",
					description: "the flag and its call site",
					members: [
						{ path: "src/greeting.ts", hunkIds: ["h1"] },
						{ path: "src/main.ts" },
					],
				},
			],
			suggestedEntryPoint: "src/greeting.ts",
		},
		walkthrough: {
			steps: [
				{
					title: "the flag",
					narration: "an optional parameter keeps existing callers working",
					focus: [{ path: "src/greeting.ts", hunkIds: ["h1"] }],
				},
			],
		},
		explanations: [
			{
				anchor: {
					path: "src/greeting.ts",
					side: "new",
					startLine: 1,
					endLine: 1,
				},
				kind: "intent",
				body: "the default keeps the change backward compatible",
			},
		],
		risk: {
			hunkRisks: [{ hunkId: "h1", score: 2, reason: "behavior change" }],
		},
	};
}

describe("comprehensionOutSchema", () => {
	it("parses a valid ComprehensionOut sample", () => {
		const sample = validSample();
		expect(comprehensionOutSchema.parse(sample)).toEqual(sample);
	});

	it("parses the real CLI's captured structured_output — the contract-compatibility proof", () => {
		const parsed = comprehensionOutSchema.parse(fixtureStructuredOutput());
		expect(parsed.intentMap.clusters.length).toBeGreaterThan(0);
		expect(parsed.walkthrough.steps.length).toBeGreaterThan(0);
		expect(parsed.explanations.length).toBeGreaterThan(0);
	});

	it("rejects an explanations array over the CON-013 cap", () => {
		const sample = validSample();
		sample.explanations = Array.from(
			{ length: MAX_EXPLANATIONS + 1 },
			() => sample.explanations[0],
		);
		expect(comprehensionOutSchema.safeParse(sample).success).toBe(false);
	});

	it("accepts exactly the CON-013 cap of explanations", () => {
		const sample = validSample();
		sample.explanations = Array.from(
			{ length: MAX_EXPLANATIONS },
			() => sample.explanations[0],
		);
		expect(comprehensionOutSchema.safeParse(sample).success).toBe(true);
	});

	it.each([1, 6, 3.5])("rejects the out-of-range risk score %s", (score) => {
		const sample = validSample();
		sample.risk.hunkRisks[0] = {
			hunkId: "h1",
			score: score as never,
			reason: "out of range",
		};
		expect(comprehensionOutSchema.safeParse(sample).success).toBe(false);
	});

	it("rejects a negative anchor line and an unknown side", () => {
		const negative = validSample();
		negative.explanations[0].anchor.startLine = -1;
		expect(comprehensionOutSchema.safeParse(negative).success).toBe(false);

		const badSide = validSample();
		badSide.explanations[0].anchor.side = "both" as never;
		expect(comprehensionOutSchema.safeParse(badSide).success).toBe(false);
	});

	it("rejects an unknown cluster kind", () => {
		const sample = validSample();
		sample.intentMap.clusters[0].kind = "misc" as never;
		expect(comprehensionOutSchema.safeParse(sample).success).toBe(false);
	});
});
