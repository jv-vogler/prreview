import { z } from "zod";
import { MAX_EXPLANATIONS } from "./limits";

/**
 * The stage A output contract (ARCHITECTURE §7's ComprehensionOut), authored
 * in zod: converted once to the inline JSON Schema handed to `--json-schema`
 * (toJsonSchema.ts) and reused verbatim to re-validate `structured_output` on
 * receipt (REQ-007) — a parse failure is EngineError('schema-violation'), a
 * failed run, never a half-applied result.
 *
 * `test/fixtures/claude/comprehension.jsonl` was captured against this exact
 * shape; schemas.test.ts parses its structured_output to prove the contract
 * still matches what the CLI was actually asked for.
 */

/** what the model emits; the server converts it into a full Anchor by
 * capturing the snapshot and computing `placement` (§6, §7) */
export const agentAnchorSchema = z.object({
	path: z.string(),
	side: z.enum(["old", "new"]),
	startLine: z.int().min(0),
	endLine: z.int().min(0),
});

const intentMapClusterMemberSchema = z.object({
	path: z.string(),
	/** absent means the whole file — the agent referenced it without hunk precision */
	hunkIds: z.array(z.string()).optional(),
});

const intentMapClusterSchema = z.object({
	name: z.string(),
	kind: z.enum([
		"core",
		"refactor",
		"tests",
		"config",
		"docs",
		"generated",
		"chore",
	]),
	description: z.string(),
	members: z.array(intentMapClusterMemberSchema),
});

const intentMapOutSchema = z.object({
	summary: z.string(),
	clusters: z.array(intentMapClusterSchema),
	suggestedEntryPoint: z.string(),
});

const walkthroughFocusSchema = z.object({
	path: z.string(),
	hunkIds: z.array(z.string()),
});

const walkthroughStepOutSchema = z.object({
	title: z.string(),
	narration: z.string(),
	focus: z.array(walkthroughFocusSchema),
});

const walkthroughOutSchema = z.object({
	steps: z.array(walkthroughStepOutSchema),
});

const explanationOutSchema = z.object({
	anchor: agentAnchorSchema,
	kind: z.enum(["intent", "mechanism", "implication"]),
	body: z.string(),
});

/** hunks the agent does not list keep the baseline risk score of 1 (§7) */
const riskOutSchema = z.object({
	hunkRisks: z.array(
		z.object({
			hunkId: z.string(),
			score: z.literal([2, 3, 4, 5]),
			reason: z.string(),
		}),
	),
});

/**
 * Risk is part of the schema and persisted raw; M2 renders nothing from it
 * and puts nothing about it on the wire — F6's heat is M3's, and re-running
 * comprehension in M3 just to obtain it would be waste (ALT-008).
 */
export const comprehensionOutSchema = z.object({
	intentMap: intentMapOutSchema,
	walkthrough: walkthroughOutSchema,
	explanations: z.array(explanationOutSchema).max(MAX_EXPLANATIONS),
	risk: riskOutSchema,
});

export type ComprehensionOut = z.infer<typeof comprehensionOutSchema>;
