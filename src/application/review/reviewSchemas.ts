import { z } from "zod";
import type { ReviewDepth } from "../../domain/review/ReviewDepth";

/**
 * What a lens is allowed to say.
 *
 * Nearly every quality rule that *can* be a schema constraint is one, because a
 * schema is enforced by the CLI itself and retried against, while a prompt
 * sentence is advice weighed against everything else the model was told. The
 * rules that cannot be expressed here — the pasteable length budget measured on
 * rendered prose, the hallucinated-diff check, path resolution — live in code
 * (`formGate.ts`, `groundingGate.ts`), not in prose either.
 */

/** how much it matters, four tiers and no more */
const SEVERITY = ["blocker", "should-fix", "consider", "nitpick"] as const;

/**
 * A narrowed category list with **no `other`**. An escape hatch labelled
 * "other" collects everything the model could not be bothered to classify, and
 * a category that means nothing cannot be filtered, sorted, or trusted.
 */
const CATEGORY = [
	"correctness",
	"security",
	"edge-case",
	"performance",
	"data-loss",
	"concurrency",
	"api-contract",
	"error-handling",
	"testing",
	"design",
] as const;

/** how the claim was established — its own field, so it never lands in the body */
const proofSchema = z.object({
	/**
	 * `traced` means the path was followed end to end through code actually
	 * read. `inferred` means at least one step rests on something unverified,
	 * and the UI hedges accordingly. There is deliberately no "tested": prreview
	 * cannot run anything (Write/Edit/Bash are forbidden), and a verification
	 * word that implies execution would be a lie by connotation.
	 */
	mode: z.enum(["traced", "inferred"]),
	how: z.string().max(240),
});

/**
 * The single optional evidence block. One object rather than a list of them, so
 * two competing blocks cannot exist on one finding and the UI never has to pick.
 */
const evidenceSchema = z.object({
	path: z.string(),
	startLine: z.int().min(1),
	endLine: z.int().min(1),
	/** what the reader should notice there, not a restatement of the code */
	note: z.string().max(200),
});

const anchorSchema = z.object({
	path: z.string(),
	side: z.enum(["old", "new"]),
	startLine: z.int().min(0),
	endLine: z.int().min(0),
});

/** the pasteable body; the hard budget is re-checked on rendered prose in code */
const BODY_MAX = 900;
const TITLE_MAX = 80;

function findingSchema(severities: readonly string[]) {
	return z.object({
		title: z.string().max(TITLE_MAX),
		body: z.string().max(BODY_MAX),
		anchor: anchorSchema,
		severity: z.enum(severities as [string, ...string[]]),
		category: z.enum(CATEGORY),
		/** 0–100; the presets all floor it at 80 before anything is kept */
		confidence: z.int().min(0).max(100),
		proof: proofSchema,
		evidence: evidenceSchema.optional(),
		/**
		 * A test that would fail today and pass once fixed, as an artifact rather
		 * than an execution. prreview never runs it — see `proof.mode`.
		 */
		reproTest: z.string().max(800).optional(),
	});
}

/**
 * One lens's output.
 *
 * `findings` has **no minimum**. Silence is a succeeding outcome: a lens that
 * finds nothing worth saying should say nothing, and a floor would manufacture
 * the padding every reviewer learns to ignore.
 */
export function buildReviewOutSchema(depth: ReviewDepth) {
	const severities = depth.allowNitpick
		? SEVERITY
		: SEVERITY.filter((tier) => tier !== "nitpick");

	return z.object({
		findings: z.array(findingSchema(severities)).max(depth.maxFindings),
		/**
		 * Problems that predate this change. A separate array rather than a flag,
		 * because the split has to survive every downstream step: these must never
		 * reach review feedback about someone else's change.
		 */
		relatedFindings: z
			.array(findingSchema(severities))
			.max(depth.maxRelatedFindings),
	});
}

export type ReviewOut = z.infer<ReturnType<typeof buildReviewOutSchema>>;
export type ReviewFinding = ReviewOut["findings"][number];
export type FindingSeverity = (typeof SEVERITY)[number];
export type FindingCategory = (typeof CATEGORY)[number];

export const SEVERITIES: readonly FindingSeverity[] = SEVERITY;
export const CATEGORIES: readonly FindingCategory[] = CATEGORY;

/** a representative instance for the shape-level gates (CON-014, CON-005) */
export const representativeReviewOutSchema = buildReviewOutSchema({
	preset: "standard",
	lenses: ["correctness", "security"],
	allowNitpick: true,
	maxFindings: 15,
	maxRelatedFindings: 5,
	confidenceFloor: 80,
	parallelChildren: 3,
	effort: null,
	maxBudgetUsd: null,
});
