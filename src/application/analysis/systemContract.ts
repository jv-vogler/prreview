/**
 * The system-prompt contract of ARCHITECTURE §7, composed clause by clause so
 * each task appends exactly the rules that govern it. M2's comprehension task
 * uses clauses 1 (grounding), 4 (anchoring), 5 (confidence) plus the
 * explanation-species clause. Clauses 2, 3, and 6 govern findings and
 * dismissal memory: they are authored here so the §7 text lives in one place,
 * but no M2 task includes them — M3 wires them in.
 */

/** clause 1 */
export function groundingMandateClause(): string {
	return [
		"Grounding mandate. Every claim you make must be grounded in code you",
		"actually read in this workspace during this session, using your Read,",
		"Glob, and Grep tools. Cite only files and lines you have read; never",
		"speculate about code you have not opened. The diff you were given is a",
		"summary — the workspace holds the code at the reviewed revision, and it",
		"is the ground truth.",
	].join("\n");
}

/** clause 2 — findings only; not part of any M2 task (M3 wires it in) */
export function precisionOverVolumeClause(): string {
	return [
		"Precision over volume. Report at most max(3, changedLines / 100)",
		"findings, hard cap 15. Never report what a linter, typechecker, or CI",
		"catches. Never report style.",
	].join("\n");
}

/** clause 3 — findings only; not part of any M2 task (M3 wires it in) */
export function speciesDisciplineClause(): string {
	return [
		"Species discipline. Findings are problems introduced by this change.",
		"Pre-existing problems go to relatedFindings, never mixed in.",
	].join("\n");
}

/** clause 4 */
export function anchoringRulesClause(): string {
	return [
		"Anchoring rules. Anchor every annotation on the new side at the most",
		"specific lines possible; use the old side only for pure deletions. The",
		"diff prints explicit old and new line numbers on every line — use those",
		"printed numbers exactly, and never derive line numbers arithmetically",
		"from hunk headers.",
	].join("\n");
}

/** clause 5 */
export function confidenceCalibrationClause(): string {
	return [
		"Confidence calibration. high: you read every piece of code involved and",
		"can trace the behavior end to end — a reader following your citations",
		"would reach the same conclusion. medium: the evidence is strong but one",
		"step rests on inference about code or inputs you could not fully",
		"verify. low: a plausible concern worth a human look that you could not",
		"confirm from what you read.",
	].join("\n");
}

/** clause 6 — dismissal memory; not part of any M2 task (M3 wires it in) */
export function dismissalMemoryClause(): string {
	return [
		"Dismissal memory. Prior dismissals and their reasons are supplied with",
		"the task; do not re-raise a finding the reviewer already dismissed.",
	].join("\n");
}

/** M2's explanation species rule — explanations orient, they never review */
export function explanationSpeciesClause(): string {
	return [
		"Explanations. Explanations describe intent (why this code changed),",
		"mechanism (how it works), or implication (what follows from it); they",
		"are never review comments and never report problems. Write them for a",
		"reviewer meeting this change for the first time.",
	].join("\n");
}

/** the contract appended to every stage A comprehension run */
export function comprehensionContract(): string {
	return [
		groundingMandateClause(),
		anchoringRulesClause(),
		confidenceCalibrationClause(),
		explanationSpeciesClause(),
	].join("\n\n");
}
