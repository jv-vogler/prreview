import { z } from "zod";
import {
	REWORK_IDLE_TIMEOUT_MS,
	REWORK_MAX_TURNS,
} from "../../domain/agentTask/limits";
import { reworkContract } from "../../domain/agentTask/reviewContract";
import { renderNumberedDiff } from "../../domain/agentTask/reviewPrompt";
import {
	assertSchemaFitsArgv,
	toJsonSchema,
} from "../../domain/agentTask/toJsonSchema";
import type { ChangesetId } from "../../domain/changeset/ChangesetId";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { effectiveBody, isDeleted } from "../../domain/finding/curation";
import { findingIndexFor } from "../../domain/finding/findingId";
import { BODY_MAX, type ReviewFinding } from "../../domain/pass/ReviewPass";
import type { FindingEdit } from "../../domain/pass/StoredReview";
import type { RunProgressUpdate } from "../../domain/run/RunProgress";
import type { Engine } from "../ports/Engine";
import type { Git } from "../ports/Git";
import type { RunContext, RunJob, RunOutcome } from "../ports/RunManager";
import type { SessionStore } from "../ports/SessionStore";
import { runEngineTask } from "./runEngineTask";

export type ReworkInstruction = "concise" | "expand" | "explain";

const REWORK_INSTRUCTION_PROMPT: Record<ReworkInstruction, string> = {
	concise:
		"Make the body noticeably shorter without losing the essential point.",
	expand:
		"Add the missing detail that would help the author act on it, while staying concise.",
	explain:
		"Rewrite the body to explain the reasoning more thoroughly, in plain language a non-engineer could follow.",
};

const reworkResultSchema = z.object({
	body: z.string().min(1).max(BODY_MAX),
});

export interface ReworkFindingInput {
	changesetId: ChangesetId;
	findingId: string;
	instruction: ReworkInstruction;
	files: readonly FileDiff[];
}

export interface ReworkFindingDeps {
	engine: Engine;
	git: Git;
	sessionStore: SessionStore;

	report: (runId: string, update: RunProgressUpdate) => void;
}

export function buildReworkJob(
	deps: ReworkFindingDeps,
	input: ReworkFindingInput,
): RunJob {
	return async (context: RunContext): Promise<RunOutcome> => {
		const { finding, edit } = await reworkableFinding(deps.sessionStore, input);

		const jsonSchema = toJsonSchema(reworkResultSchema);
		assertSchemaFitsArgv(jsonSchema);
		const prompt = buildReworkPrompt({
			finding,
			currentBody: effectiveBody(finding, edit),
			instruction: input.instruction,
			files: input.files,
		});

		const result = await runEngineTask(
			deps,
			context,
			{
				jsonSchema,
				maxTurns: REWORK_MAX_TURNS,
				idleTimeoutMs: REWORK_IDLE_TIMEOUT_MS,
				systemContract: reworkContract(),
				outputSchema: reworkResultSchema,
			},
			{ prompt, workspaceDir: await deps.git.repoRoot() },
			{
				noResult: "The rework ended with no result.",
				failed: "The rework run failed.",
			},
		);
		if (!result.ok) {
			return result.outcome;
		}
		const output = reworkResultSchema.parse(result.structuredOutput);
		return { ok: true, result: output.body };
	};
}

async function reworkableFinding(
	sessionStore: SessionStore,
	input: ReworkFindingInput,
): Promise<{ finding: ReviewFinding; edit: FindingEdit | undefined }> {
	const stored = await sessionStore.loadReview(input.changesetId);
	if (stored === null) {
		throw new Error("no review pass exists for this changeset yet");
	}
	const index = findingIndexFor(stored, input.findingId);
	const finding = index === null ? undefined : stored.pass.findings[index];
	if (finding === undefined) {
		throw new Error(
			`finding ${input.findingId} does not exist in the stored pass`,
		);
	}
	const edit = stored.findingEdits[input.findingId];
	if (isDeleted(edit)) {
		throw new Error(`finding ${input.findingId} has been deleted`);
	}
	return { finding, edit };
}

interface ReworkPromptInput {
	finding: ReviewFinding;
	currentBody: string;
	instruction: ReworkInstruction;
	files: readonly FileDiff[];
}

function buildReworkPrompt(input: ReworkPromptInput): string {
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
