import { z } from "zod";
import type { ChangesetId } from "../../domain/changeset/ChangesetId";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import {
	describeToolActivity,
	type RunProgressUpdate,
} from "../../domain/review/RunProgress";
import { findingIndexForCommentId } from "../../domain/review/reviewCommentId";
import type { Engine, EngineResultEvent } from "../ports/Engine";
import type { Git } from "../ports/Git";
import type { RunContext, RunJob, RunOutcome } from "../ports/RunManager";
import type { SessionStore } from "../ports/SessionStore";
import { effectiveBody, isDeleted } from "./commentEdits";
import { REWORK_IDLE_TIMEOUT_MS, REWORK_MAX_TURNS } from "./limits";
import { reworkContract } from "./reviewContract";
import { renderNumberedDiff } from "./reviewPrompt";
import { BODY_MAX, type ReviewFinding } from "./reviewSchema";
import { assertSchemaFitsArgv, toJsonSchema } from "./toJsonSchema";

/**
 * What the reader can ask for on one comment (TASK-048, REQ-006). All three
 * are about the same axis — how much the body says — never about the
 * finding's substance: the agent re-verifies, it does not relitigate.
 */
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

export interface ReworkCommentInput {
	changesetId: ChangesetId;
	commentId: string;
	instruction: ReworkInstruction;
	/** the diff currently on screen, for the cited-code grounding */
	files: readonly FileDiff[];
}

export interface ReworkCommentDeps {
	engine: Engine;
	git: Git;
	sessionStore: SessionStore;
	/** the manager's own report(), captured so the job can call back into it */
	report: (runId: string, update: RunProgressUpdate) => void;
}

/**
 * Builds the job that reworks one comment: reuses the same `Engine` port and
 * one-run-at-a-time lane as a review pass (no chat, no second lane), but
 * spends far less turn budget and never writes to the store itself — its
 * result is a proposal the reader accepts or rejects through the normal
 * edit path (TASK-046), never an in-place overwrite.
 */
export function buildReworkJob(
	deps: ReworkCommentDeps,
	input: ReworkCommentInput,
): RunJob {
	return async (context: RunContext): Promise<RunOutcome> => {
		const stored = await deps.sessionStore.loadReview(input.changesetId);
		if (stored === null) {
			throw new Error("no review pass exists for this changeset yet");
		}
		const index = findingIndexForCommentId(input.commentId);
		const finding: ReviewFinding | undefined =
			index === null ? undefined : stored.pass.findings[index];
		if (finding === undefined) {
			throw new Error(
				`comment ${input.commentId} does not exist in the stored pass`,
			);
		}
		const edit = stored.commentEdits[input.commentId];
		if (isDeleted(edit)) {
			throw new Error(`comment ${input.commentId} has been deleted`);
		}

		const jsonSchema = toJsonSchema(reworkResultSchema);
		assertSchemaFitsArgv(jsonSchema);
		const prompt = buildReworkPrompt({
			finding,
			currentBody: effectiveBody(finding, edit),
			instruction: input.instruction,
			files: input.files,
		});

		const onAbort = () => {
			void deps.engine.stop();
		};
		context.signal.addEventListener("abort", onAbort);
		if (context.signal.aborted) {
			onAbort();
		}

		try {
			let terminal: EngineResultEvent | null = null;
			for await (const event of deps.engine.runTask(
				{
					jsonSchema,
					maxTurns: REWORK_MAX_TURNS,
					idleTimeoutMs: REWORK_IDLE_TIMEOUT_MS,
					systemContract: reworkContract(),
					outputSchema: reworkResultSchema,
				},
				{ prompt, workspaceDir: await deps.git.repoRoot() },
			)) {
				if (event.type === "tool") {
					deps.report(context.runId, {
						kind: "activity",
						activity: describeToolActivity(event.name, event.target),
					});
				} else if (event.type === "result") {
					terminal = event;
				}
			}

			if (terminal === null) {
				return {
					ok: false,
					reason: "crashed",
					message: "The rework ended with no result.",
				};
			}
			if (!terminal.ok) {
				return {
					ok: false,
					reason: terminal.reason,
					message: terminal.stderrTail || "The rework run failed.",
				};
			}
			const output = reworkResultSchema.parse(terminal.structuredOutput);
			return { ok: true, result: output.body };
		} finally {
			context.signal.removeEventListener("abort", onAbort);
		}
	};
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
		`Tier: ${input.finding.tier ?? "none (this comment is a question, not a defect)"}`,
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
