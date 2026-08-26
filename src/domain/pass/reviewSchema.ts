import { z } from "zod";

/**
 * What one review pass is allowed to say (TASK-032). Mirrors the
 * `pr:local-review` skill's own severity ladder and lane split, adapted for
 * structured output instead of a markdown scratchfile — see
 * `reviewPrompt.ts` for the prose contract this shape enforces.
 */

/** the four severity tiers, mapped 1:1 onto GitHub alert blocks */
const TIER = ["blocker", "should-fix", "suggestion", "nitpick"] as const;

/**
 * A finding either claims something is wrong or asks the author why. A
 * question carries no `tier` because the ladder measures how bad something
 * is, and a question has no badness; the union below is what keeps those two
 * facts from drifting apart. A finding that names no kind at all reads as a
 * defect, which is every pass written before questions existed.
 */
const KIND = ["defect", "question"] as const;

/**
 * Whether an explanation's reason was read or reconstructed. Never
 * rendered: it exists to mark where an explanation stops and a question
 * starts, and is stored on the pass so it stays minable later.
 */
const GROUNDING = ["code", "inferred"] as const;

/**
 * What a re-checked carried finding came back as. `resolved` drops it from
 * the pass and credits the fix; `stands` keeps it, re-verified.
 */
const CARRIED_VERDICT = ["stands", "resolved"] as const;

/**
 * `review` findings are feedback on this change; `pre-existing` findings
 * predate it. The split is a schema field, not a flag, because it has to
 * survive every downstream step: a pre-existing finding must never become a
 * publishable review comment on this PR (REQ-011).
 */
const LANE = ["review", "pre-existing"] as const;

/**
 * The scope check's outcome as a machine-readable signal: the verdict prose
 * carries the nuance, this carries the color. `no-ticket` doubles as "no
 * spec to judge against"; absent (older passes) reads as neutral.
 */
const SCOPE = [
	"matches",
	"misses-pieces",
	"unrelated-extras",
	"no-ticket",
] as const;

const TITLE_MAX = 80;
/**
 * Generous headroom over the pasteable ≤500-character budget, which is
 * measured on rendered prose in the prompt itself, not enforced structurally.
 * Exported so a reworded body (TASK-048) is held to the same ceiling as the
 * one the engine wrote.
 */
export const BODY_MAX = 900;
/** aids are exempt from the prose budget, so this has to fit a diff and a table */
const EVIDENCE_MAX = 1200;
const PROOF_MAX = 240;
const OVERVIEW_MAX = 900;
const VERDICT_MAX = 300;
const TICKET_MAX = 300;
const MAX_FINDINGS = 40;
const SAYS_LINE_MAX = 160;
const SAYS_LINES_MAX = 3;
/** a clause, not a category: enough for "Questions get their own count and are never tiered" */
const TOPIC_MAX = 110;
const MAX_EXPLANATIONS = 120;
/** one clause saying why a carried finding no longer holds, not a second review */
const CARRIED_WHY_MAX = 240;

/**
 * The lengths are a budget the engine is held to as it writes a pass, not an
 * invariant of the bytes afterwards. A pass already on disk was within budget
 * when it was written, so lowering a ceiling must never make it unreadable —
 * that is what turned a tightened `OVERVIEW_MAX` into "does not match the
 * review artifact schema" on a session recorded an hour earlier. So the shape
 * is built twice: `reviewPassSchema` carries the ceilings and gates what the
 * engine may hand back, and `storedReviewPassSchema` drops them and gates only
 * the shape, which is all a reader off disk can honestly ask for.
 */
function bounded(max: number, enforce: boolean) {
	return enforce ? z.string().max(max) : z.string();
}

/**
 * A union on `kind`, not one object with a rule bolted on afterwards. The
 * shape reaches the CLI as `oneOf` in `--json-schema`, so a tier-less defect
 * or a tiered question is caught where the CLI still has a turn to fix it,
 * rather than at `parse` time after the run, where the only outcome left is
 * discarding the whole pass.
 *
 * A finding with no `kind` at all reads as a defect: that is every pass
 * written before questions existed, and it must keep loading off disk.
 */
function buildFindingSchema(enforce: boolean) {
	const shared = {
		path: z.string().min(1),
		startLine: z.int().min(1),
		endLine: z.int().min(1),
		/** plain-language scan aid for the reviewer's list; never published */
		title: bounded(TITLE_MAX, enforce),
		/** the alert block plus the pasteable paragraph — never restates the diff */
		body: bounded(BODY_MAX, enforce),
		/** the visual aid pasted under `body`: a ```diff fix, a table, or input → expected/got */
		evidence: bounded(EVIDENCE_MAX, enforce).optional(),
		/** "Verified: <how>" or "Inferred: <why still confident>" — the triage line */
		proof: bounded(PROOF_MAX, enforce),
		/** true when `proof` describes something actually run, not inferred */
		verified: z.boolean(),
		lane: z.enum(LANE),
		/**
		 * The other files opened to convince yourself this finding is real.
		 * A later pass re-checks a carried finding only when one of these has
		 * moved, so a finding that names none has to be re-checked from
		 * scratch every time.
		 */
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

/**
 * One authored account of a change, anchored the same way a finding is: the
 * author's voice, never review feedback. `says` is an array of sentences
 * rather than a paragraph because the field shape, not a budget, is what
 * forces conciseness. Explanations sharing a `topic` label form one topic.
 */
function buildExplanationSchema(enforce: boolean) {
	const says = z.array(bounded(SAYS_LINE_MAX, enforce)).min(1);
	return z.object({
		path: z.string().min(1),
		startLine: z.int().min(1),
		endLine: z.int().min(1),
		/** one sentence per entry — what the diff cannot say on its own */
		says: enforce ? says.max(SAYS_LINES_MAX) : says,
		/** a clause saying what changed; explanations sharing a label form one topic */
		topic: bounded(TOPIC_MAX, enforce).optional(),
		/** read the reason, or reconstructed it — never rendered, see GROUNDING */
		grounding: z.enum(GROUNDING).default("inferred"),
	});
}

function buildPassSchema(enforce: boolean) {
	const findings = z.array(buildFindingSchema(enforce));
	const explanations = z.array(buildExplanationSchema(enforce));
	return z.object({
		/** business-level description, two or three short markdown paragraphs */
		overview: bounded(OVERVIEW_MAX, enforce),
		/** one line: matches the ticket, misses a piece, or does unrelated extras */
		verdict: bounded(VERDICT_MAX, enforce),
		/** optional so passes written before the field existed still parse */
		scope: z.enum(SCOPE).optional(),
		/** null when no ticket reference was found anywhere */
		ticket: bounded(TICKET_MAX, enforce).nullable(),
		/** no minimum: a clean PR is a valid, complete review with no findings */
		findings: enforce ? findings.max(MAX_FINDINGS) : findings,
		/** defaulted so passes written before explanations existed still parse */
		explanations: (enforce
			? explanations.max(MAX_EXPLANATIONS)
			: explanations
		).default([]),
		/**
		 * One verdict per carried finding the prompt asked to have re-checked.
		 * Absent on a pass that carried nothing, which is every full pass.
		 */
		carried: z
			.array(
				z.object({
					id: z.string(),
					verdict: z.enum(CARRIED_VERDICT),
					/** one clause, for the verdict line's credit */
					why: bounded(CARRIED_WHY_MAX, enforce).optional(),
				}),
			)
			.optional(),
	});
}

export const reviewPassSchema = buildPassSchema(true);

/** what a pass already on disk has to be, which is the shape and nothing more */
export const storedReviewPassSchema = buildPassSchema(false);

export type ReviewFinding = z.infer<ReturnType<typeof buildFindingSchema>>;
export type ReviewExplanation = z.infer<
	ReturnType<typeof buildExplanationSchema>
>;
export type ReviewPass = z.infer<typeof reviewPassSchema>;
export type ReviewScope = (typeof SCOPE)[number];
export type ReviewTier = (typeof TIER)[number];
export type ReviewLane = (typeof LANE)[number];
export type ReviewFindingKind = (typeof KIND)[number];
export type CarriedVerdict = (typeof CARRIED_VERDICT)[number];
export type ExplanationGrounding = (typeof GROUNDING)[number];

export const REVIEW_TIERS: readonly ReviewTier[] = TIER;
export const REVIEW_LANES: readonly ReviewLane[] = LANE;
