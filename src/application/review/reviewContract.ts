import {
	anchoringRulesClause,
	confidenceCalibrationClause,
	dismissalMemoryClause,
	groundingMandateClause,
	precisionOverVolumeClause,
	speciesDisciplineClause,
} from "../analysis/systemContract";

/**
 * The system contract every lens child runs under.
 *
 * These clauses were authored when the architecture was written and have sat
 * unused since — the comprehension pass needed only three of them. A findings
 * pass needs all six, and the two that matter most are the ones that have no
 * other enforcement point: species discipline (a pre-existing problem is never
 * review feedback about someone's change) and dismissal memory (raising a
 * finding the reviewer already rejected teaches them to stop reading).
 *
 * The prose-discipline clause is inlined rather than a second agent call. A
 * humanize pass would double the cost of the most expensive stage in the
 * pipeline and would rewrite fields the form gate has just validated, which
 * means validating them twice or trusting the rewrite.
 */
export function reviewContract(): string {
	return [
		groundingMandateClause(),
		precisionOverVolumeClause(),
		speciesDisciplineClause(),
		anchoringRulesClause(),
		confidenceCalibrationClause(),
		dismissalMemoryClause(),
		proseDisciplineClause(),
	].join("\n\n");
}

/**
 * How the comment should read.
 *
 * The worked example is doing real work here, not decoration: a voice sample
 * outranks abstract instruction for prose, and one comment that sounds like a
 * person says more than a paragraph describing what sounding like a person
 * means.
 */
export function proseDisciplineClause(): string {
	return [
		"Prose discipline. Write like a senior engineer leaving a comment on a",
		"colleague's pull request: direct, specific, and short. No preamble, no",
		"praise, no summary of what the code does, no hedging filler, no bullet",
		"lists of considerations. Lead with the consequence. This is the voice:",
		"",
		'  "This retries forever on a 4xx. `shouldRetry` only checks for a thrown',
		"  error, so a 400 response resolves and comes back through the same path",
		'  on every attempt until the deadline."',
		"",
		"Note what it does not do: it does not open by restating the function's",
		"purpose, it does not say the change is otherwise good, and it stops as",
		"soon as the point is made.",
	].join("\n");
}
