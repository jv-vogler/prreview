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
 * `review` findings are feedback on this change; `pre-existing` findings
 * predate it. The split is a schema field, not a flag, because it has to
 * survive every downstream step: a pre-existing finding must never become a
 * publishable review comment on this PR (REQ-011).
 */
const LANE = ["review", "pre-existing"] as const;

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
const OVERVIEW_MAX = 1500;
const VERDICT_MAX = 300;
const TICKET_MAX = 300;
const MAX_FINDINGS = 40;

const findingSchema = z.object({
	path: z.string().min(1),
	startLine: z.int().min(1),
	endLine: z.int().min(1),
	tier: z.enum(TIER),
	/** plain-language scan aid for the reviewer's list; never published */
	title: z.string().max(TITLE_MAX),
	/** the alert block plus the pasteable paragraph — never restates the diff */
	body: z.string().max(BODY_MAX),
	/** the visual aid pasted under `body`: a ```diff fix, a table, or input → expected/got */
	evidence: z.string().max(EVIDENCE_MAX).optional(),
	/** "Verified: <how>" or "Inferred: <why still confident>" — the triage line */
	proof: z.string().max(PROOF_MAX),
	/** true when `proof` describes something actually run, not inferred */
	verified: z.boolean(),
	lane: z.enum(LANE),
});

export const reviewPassSchema = z.object({
	/** business-level description of the change, 2-5 sentences, no code */
	overview: z.string().max(OVERVIEW_MAX),
	/** one italic line: matches the ticket, misses a piece, or does unrelated extras */
	verdict: z.string().max(VERDICT_MAX),
	/** null when no ticket reference was found anywhere */
	ticket: z.string().max(TICKET_MAX).nullable(),
	/** no minimum: a clean PR is a valid, complete review with no findings */
	findings: z.array(findingSchema).max(MAX_FINDINGS),
});

export type ReviewFinding = z.infer<typeof findingSchema>;
export type ReviewPass = z.infer<typeof reviewPassSchema>;
export type ReviewTier = (typeof TIER)[number];
export type ReviewLane = (typeof LANE)[number];

export const REVIEW_TIERS: readonly ReviewTier[] = TIER;
export const REVIEW_LANES: readonly ReviewLane[] = LANE;
