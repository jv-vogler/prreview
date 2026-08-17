import type { ReviewLens } from "../../domain/review/ReviewDepth";

/**
 * What each lens is looking for.
 *
 * One prompt per lens, one shared output schema. Separate children rather than
 * one prompt asking for everything, because a single pass asked to consider six
 * things at once reliably does two of them well and gestures at the rest — and
 * because six independent readings disagree in useful ways that adjudication
 * can then resolve.
 */

export interface LensPrompt {
	lens: ReviewLens;
	/** what this lens hunts */
	brief: string;
	/**
	 * `fresh-eyes` gets **only the diff** — no project frame, no file reads.
	 * That is the whole idea: someone meeting this code cold notices what the
	 * author stopped seeing. It is also why it emits **leads rather than
	 * findings** — a context-free reader cannot satisfy the grounding mandate,
	 * and grounding here is a checked property, so its output would fail the
	 * stamp by construction. Its leads are inputs to adjudication, not comments.
	 */
	contextFree?: boolean;
}

export const LENS_PROMPTS: Record<ReviewLens, LensPrompt> = {
	correctness: {
		lens: "correctness",
		brief: [
			"Does this code do what it evidently intends, under the inputs it will actually see?",
			"Look for: logic that inverts a condition, an off-by-one, a branch that cannot be reached, state mutated while iterated, a promise not awaited, an error swallowed, a resource not released, a value that can be null on a path that does not check it.",
			"Trace the path end to end through code you have read. If you cannot, say so in `proof.mode: inferred` rather than asserting.",
		].join("\n"),
	},
	security: {
		lens: "security",
		brief: [
			"What could an attacker, or a hostile input, do with this change?",
			"Look for: input reaching a query, a shell, a path, or a template without validation; authorization checked in one branch and not another; a secret logged or returned; a redirect or fetch to a caller-supplied host; a comparison of secrets that is not constant-time; a permission widened.",
			"Do not report the theoretical absence of a control that is plainly out of scope for this change.",
		].join("\n"),
	},
	"edge-cases": {
		lens: "edge-cases",
		brief: [
			"Where does this break at the boundaries?",
			"Look for: empty, one, and enormous; zero, negative, and overflow; unicode and empty strings; concurrent callers; a network call that times out or returns a partial response; a file that does not exist; a clock that moves backwards.",
			"Only report a boundary this change actually made reachable or made worse.",
		].join("\n"),
	},
	design: {
		lens: "design",
		brief: [
			"Will this be painful to live with?",
			"Look for: a new abstraction earning less than it costs, an interface that leaks its implementation, state that now has two owners, a dependency pointing the wrong way, duplication that will drift, a name that says something untrue.",
			"This lens has the lowest hit rate and the highest noise ceiling. Report only what you would genuinely raise in a review, not what a style guide would.",
		].join("\n"),
	},
	"fresh-eyes": {
		lens: "fresh-eyes",
		contextFree: true,
		brief: [
			"You are seeing this code for the first time and know nothing about the project.",
			"Read only the diff. Say what is confusing, surprising, or looks wrong on its face — the things the author has stopped being able to see.",
			"You have no way to verify any of it, so do not pretend to: everything you emit is a lead for someone else to check, not a review comment.",
		].join("\n"),
	},
	impact: {
		lens: "impact",
		brief: [
			"What else does this change reach?",
			"Look for: callers of a changed signature, a serialized shape that persisted data still uses, a migration without a backfill, a default that changes behaviour for existing users, an event or log consumers parse, a public API narrowed.",
			"Follow the calls. A claim about a caller you did not open is `proof.mode: inferred`.",
		].join("\n"),
	},
};

/**
 * The instruction every lens shares.
 *
 * The false-positive list is the part that earns its length. Precision is the
 * only thing that makes a review tool worth opening twice, and each line here
 * is a category that would otherwise arrive on every single run.
 */
export function sharedReviewInstruction(input: {
	tooling: string[];
	maxFindings: number;
	confidenceFloor: number;
	allowNitpick: boolean;
}): string {
	const toolLine =
		input.tooling.length === 0
			? "Never report what a linter, formatter, or typechecker catches."
			: `This repo already runs ${input.tooling.join(", ")}. Never report anything those catch.`;

	return [
		"## How to report",
		"",
		"Write each finding as the comment you would actually leave on the pull request. Consequence first: what breaks, for whom, when. Then the evidence.",
		"",
		'- Lead with the consequence, not the observation. "Retries hammer a failing endpoint" beats "the backoff is not awaited".',
		"- At most two sentences before any code. If it needs more, it is two findings or it is not worth raising.",
		"- Never restate the diff. The reader can see the code; tell them what follows from it.",
		"- Show, do not describe: a short fenced snippet beats a paragraph about one.",
		"- No preamble, no praise, no summary, no hedging filler.",
		"",
		"## What not to report",
		"",
		`- ${toolLine}`,
		"- Never report style, formatting, naming taste, or import order.",
		"- Never report a missing test unless the change breaks an existing guarantee that had one.",
		"- Never report something the change did not touch or make worse — that is a `relatedFinding`, if it is anything.",
		"- Never report a hypothetical that requires an input the code cannot receive.",
		"- Never report the same problem twice at different anchors.",
		"",
		"## Budget",
		"",
		`- At most ${input.maxFindings} findings. Fewer is better. **Zero is a correct answer** and a common one.`,
		`- Report nothing below ${input.confidenceFloor} confidence — it will be discarded anyway.`,
		input.allowNitpick
			? "- `nitpick` exists but is capped; use it only when the fix is genuinely trivial and genuinely worth it."
			: "- There is no `nitpick` tier at this depth. If it is only a nitpick, do not report it.",
		"",
		"## Anchoring and proof",
		"",
		"- Anchor on the new side, at the most specific lines possible; the old side only for pure deletions. Use the printed line numbers exactly.",
		"- `proof.mode: traced` only when you followed the path end to end through code you actually read this session. Otherwise `inferred`.",
		"- Every file you cite must be one you opened. A search hit is not a read.",
		"- `reproTest` is a test that would fail now and pass once fixed. It is an artifact for the reader; nothing here runs it.",
	].join("\n");
}
