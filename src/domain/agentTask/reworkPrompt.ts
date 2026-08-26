import { z } from "zod";
import type { FileDiff } from "../changeset/FileDiff";
import { BODY_MAX, type ReviewFinding } from "../pass/ReviewPass";
import { renderNumberedDiff } from "./reviewPrompt";

export type ReworkInstruction = "concise" | "expand" | "explain";

const REWORK_INSTRUCTION_PROMPT: Record<ReworkInstruction, string> = {
	concise:
		"Make the body noticeably shorter without losing the essential point.",
	expand:
		"Add the missing detail that would help the author act on it, while staying concise.",
	explain:
		"Rewrite the body to explain the reasoning more thoroughly, in plain language a non-engineer could follow.",
};

export const reworkResultSchema = z.object({
	body: z.string().min(1).max(BODY_MAX),
});

export interface ReworkPromptInput {
	finding: ReviewFinding;
	currentBody: string;
	instruction: ReworkInstruction;
	files: readonly FileDiff[];
}

export function buildReworkPrompt(input: ReworkPromptInput): string {
	const file = input.files.find(
		(candidate) => candidate.path === input.finding.path,
	);
	const citedCode =
		file === undefined
			? "(this file is not part of the diff currently on screen; read it directly if you need to re-check the code)"
			: renderNumberedDiff([file]);

	return [
		"You are reworking one existing review comment from a code review you already wrote. You are not posting anything to GitHub — your output replaces this one comment's body, nothing else.",
		"",
		"## The comment as it stands",
		"",
		`Path: ${input.finding.path}, lines ${input.finding.startLine}-${input.finding.endLine}`,
		`Tier: ${input.finding.kind === "question" ? "none (this comment is a question, not a defect)" : input.finding.tier}`,
		`Title: ${input.finding.title}`,
		`Current body: ${input.currentBody}`,
		...(input.finding.evidence === undefined
			? []
			: [`Evidence: ${input.finding.evidence}`]),
		"",
		"## The cited code",
		"",
		citedCode,
		"",
		"## Instruction",
		"",
		REWORK_INSTRUCTION_PROMPT[input.instruction],
		"",
		"Re-check the finding is still accurate against the code above before rewriting; if it no longer holds, say so plainly in the reworded body rather than silently softening it. Keep the same pasteable discipline as the original review: a defect keeps its alert block plus at most two sentences, a question keeps the question itself and no alert block, and either way it stays ≤500 characters and is never hard-wrapped. Return only the reworded `body`.",
	].join("\n");
}
