import { z } from "zod";

const TIER = ["blocker", "should-fix", "suggestion", "nitpick"] as const;

const KIND = ["defect", "question"] as const;

const GROUNDING = ["code", "inferred"] as const;

const CARRIED_VERDICT = ["stands", "resolved"] as const;

const LANE = ["review", "pre-existing"] as const;

const SCOPE = [
	"matches",
	"misses-pieces",
	"unrelated-extras",
	"no-ticket",
] as const;

const TITLE_MAX = 80;

export const BODY_MAX = 900;

const EVIDENCE_MAX = 1200;
const PROOF_MAX = 240;
const OVERVIEW_MAX = 900;
const VERDICT_MAX = 300;
const TICKET_MAX = 300;
const MAX_FINDINGS = 40;
const SAYS_LINE_MAX = 160;
const SAYS_LINES_MAX = 3;

const TOPIC_MAX = 110;
const MAX_EXPLANATIONS = 120;

const CARRIED_WHY_MAX = 240;

function bounded(max: number, enforce: boolean) {
	return enforce ? z.string().max(max) : z.string();
}

function buildFindingSchema(enforce: boolean) {
	const shared = {
		path: z.string().min(1),
		startLine: z.int().min(1),
		endLine: z.int().min(1),

		title: bounded(TITLE_MAX, enforce),

		body: bounded(BODY_MAX, enforce),

		evidence: bounded(EVIDENCE_MAX, enforce).optional(),

		proof: bounded(PROOF_MAX, enforce),

		verified: z.boolean(),
		lane: z.enum(LANE),

		dependsOn: z.array(z.string()).optional(),
	};
	return z.preprocess(
		defaultToDefect,
		z.discriminatedUnion("kind", [
			z.object({
				kind: z.literal("defect"),
				tier: z.enum(TIER),
				...shared,
			}),
			z.object({ kind: z.literal("question"), ...shared }),
		]),
	);
}

function defaultToDefect(finding: unknown): unknown {
	if (typeof finding !== "object" || finding === null || "kind" in finding) {
		return finding;
	}
	return { ...finding, kind: "defect" };
}

function buildExplanationSchema(enforce: boolean) {
	const says = z.array(bounded(SAYS_LINE_MAX, enforce)).min(1);
	return z.object({
		path: z.string().min(1),
		startLine: z.int().min(1),
		endLine: z.int().min(1),

		says: enforce ? says.max(SAYS_LINES_MAX) : says,

		topic: bounded(TOPIC_MAX, enforce).optional(),

		grounding: z.enum(GROUNDING).default("inferred"),
	});
}

function buildPassSchema(enforce: boolean) {
	const findings = z.array(buildFindingSchema(enforce));
	const explanations = z.array(buildExplanationSchema(enforce));
	return z.object({
		overview: bounded(OVERVIEW_MAX, enforce),

		verdict: bounded(VERDICT_MAX, enforce),

		scope: z.enum(SCOPE).optional(),

		ticket: bounded(TICKET_MAX, enforce).nullable(),

		findings: enforce ? findings.max(MAX_FINDINGS) : findings,

		explanations: (enforce
			? explanations.max(MAX_EXPLANATIONS)
			: explanations
		).default([]),

		carried: z
			.array(
				z.object({
					id: z.string(),
					verdict: z.enum(CARRIED_VERDICT),

					why: bounded(CARRIED_WHY_MAX, enforce).optional(),
				}),
			)
			.optional(),
	});
}

export const reviewOutputSchema = buildPassSchema(true);

export const storedReviewPassSchema = buildPassSchema(false);

export type ReviewFinding = z.infer<ReturnType<typeof buildFindingSchema>>;
export type ReviewExplanation = z.infer<
	ReturnType<typeof buildExplanationSchema>
>;
export type ReviewPass = z.infer<typeof reviewOutputSchema>;
export type ReviewTier = (typeof TIER)[number];
export type ReviewLane = (typeof LANE)[number];
export type ReviewFindingKind = (typeof KIND)[number];
