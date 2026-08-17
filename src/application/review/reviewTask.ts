import { changesetIdFor } from "../../domain/changeset/ChangesetId";
import type { ChangesetRef } from "../../domain/changeset/ChangesetRef";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { ReviewDepth, ReviewLens } from "../../domain/review/ReviewDepth";
import { ANALYSIS_TIMEOUT_MS, REVIEW_MAX_TURNS } from "../analysis/limits";
import { serializeNud } from "../analysis/nud";
import { toJsonSchema } from "../analysis/toJsonSchema";
import type { SessionResume, TaskInput, TaskSpec } from "../ports/Engine";
import { LENS_PROMPTS, sharedReviewInstruction } from "./lensPrompts";
import type { ProjectFrame } from "./projectFrame";
import { reviewContract } from "./reviewContract";
import { buildReviewOutSchema } from "./reviewSchemas";

export interface BuildLensTaskInput {
	lens: ReviewLens;
	depth: ReviewDepth;
	frame: ProjectFrame;
	ref: ChangesetRef;
	files: readonly FileDiff[];
	roundId: string;
	workspaceDir: string;
	/**
	 * The comprehension session to fork from, when one exists.
	 *
	 * Every lens resume passes `fork: true`. Concurrent plain resumes interleave
	 * into the parent's history (spike 4), and five of them at once is exactly
	 * the case that produces an unreadable transcript nobody notices until they
	 * try to resume it. Measured clean at five forks (spike 8).
	 */
	resumeSessionId: string | null;
	/** dismissed findings, so the same one is not raised twice */
	suppressions: readonly string[];
}

export function buildLensTask(input: BuildLensTaskInput): {
	task: TaskSpec;
	input: TaskInput;
} {
	const schema = buildReviewOutSchema(input.depth);
	const prompt =
		input.lens === "fresh-eyes"
			? freshEyesPrompt(input)
			: groundedLensPrompt(input);

	const resume: SessionResume | undefined =
		input.resumeSessionId === null
			? undefined
			: { sessionId: input.resumeSessionId, fork: true };

	return {
		task: {
			stage: `review:${input.lens}`,
			jsonSchema: toJsonSchema(schema),
			maxTurns: REVIEW_MAX_TURNS,
			timeoutMs: ANALYSIS_TIMEOUT_MS,
			systemContract: reviewContract(),
			outputSchema: schema,
			...(resume === undefined ? {} : { resume }),
			...(input.depth.effort === null ? {} : { effort: input.depth.effort }),
			...(input.depth.maxBudgetUsd === null
				? {}
				: { maxBudgetUsd: input.depth.maxBudgetUsd }),
		},
		input: { prompt, workspaceDir: input.workspaceDir },
	};
}

function groundedLensPrompt(input: BuildLensTaskInput): string {
	const lens = LENS_PROMPTS[input.lens];
	return [
		`You are reviewing a code change through one lens: **${input.lens}**.`,
		`Changeset ${changesetIdFor(input.ref.source)}: base ${input.ref.baseSha}, head ${input.ref.headSha ?? "the working tree"}.`,
		`Your working directory, ${input.workspaceDir}, holds the code at the reviewed revision. Read it — every claim you make must rest on code you opened.`,
		"",
		input.frame.text,
		"",
		`## Your lens: ${input.lens}`,
		"",
		lens.brief,
		"",
		suppressionSection(input.suppressions),
		"",
		sharedReviewInstruction({
			tooling: input.frame.tooling,
			maxFindings: input.depth.maxFindings,
			confidenceFloor: input.depth.confidenceFloor,
			allowNitpick: input.depth.allowNitpick,
		}),
		"",
		"## The change",
		"",
		serializeNud({
			ref: input.ref,
			roundId: input.roundId,
			files: input.files,
		}),
	].join("\n");
}

/**
 * The context-free reading. No project frame, no conventions, no suppressions —
 * giving it any of those would defeat the only thing it is for.
 */
function freshEyesPrompt(input: BuildLensTaskInput): string {
	const lens = LENS_PROMPTS["fresh-eyes"];
	return [
		"You are reviewing a code change you know nothing about.",
		"",
		lens.brief,
		"",
		"Report at most 5 leads. Set `proof.mode` to `inferred` on every one — you have verified nothing — and keep `confidence` honest about that.",
		"Anchor each lead on the printed line numbers.",
		"",
		"## The change",
		"",
		serializeNud({
			ref: input.ref,
			roundId: input.roundId,
			files: input.files,
		}),
	].join("\n");
}

function suppressionSection(suppressions: readonly string[]): string {
	if (suppressions.length === 0) {
		return "";
	}
	return [
		"## Already dismissed",
		"",
		"The reviewer has seen and dismissed these. Do not raise them again:",
		...suppressions.map((entry) => `- ${entry}`),
	].join("\n");
}
