import { changesetIdFor } from "../../domain/changeset/ChangesetId";
import type { ChangesetRef } from "../../domain/changeset/ChangesetRef";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { TaskInput, TaskSpec } from "../ports/Engine";
import { ANALYSIS_TIMEOUT_MS, COMPREHENSION_MAX_TURNS } from "./limits";
import { serializeNud } from "./nud";
import { comprehensionOutSchema } from "./schemas";
import { comprehensionContract } from "./systemContract";
import { toJsonSchema } from "./toJsonSchema";

export interface BuildComprehensionTaskInput {
	ref: ChangesetRef;
	files: readonly FileDiff[];
	roundId: string;
	/** the directory holding the code at the reviewed revision (REQ-005) */
	workspaceDir: string;
}

export interface ComprehensionTask {
	task: TaskSpec;
	input: TaskInput;
}

/**
 * Assembles stage A's TaskSpec + TaskInput from a round (ARCHITECTURE §7):
 * the prompt frames the changeset, carries the truncated NUD, and asks for
 * the comprehension object; the schema, budgets, and system contract come
 * from their own modules. Stage A always starts a fresh session — no resume.
 */
export function buildComprehensionTask(
	input: BuildComprehensionTaskInput,
): ComprehensionTask {
	const prompt = [
		framing(input),
		serializeNud({
			ref: input.ref,
			roundId: input.roundId,
			files: input.files,
		}),
		instruction(),
	].join("\n\n");

	return {
		task: {
			stage: "comprehension",
			jsonSchema: toJsonSchema(comprehensionOutSchema),
			maxTurns: COMPREHENSION_MAX_TURNS,
			timeoutMs: ANALYSIS_TIMEOUT_MS,
			systemContract: comprehensionContract(),
		},
		input: { prompt, workspaceDir: input.workspaceDir },
	};
}

function framing(input: BuildComprehensionTaskInput): string {
	const { ref, workspaceDir } = input;
	return [
		"You are analyzing a code change under review.",
		`Changeset ${changesetIdFor(ref.source)}: base ${ref.baseSha}, head ${ref.headSha ?? "the working tree"}.`,
		`Your working directory, ${workspaceDir}, holds the code exactly at the reviewed revision — read it to ground every claim.`,
		"Below is the changed code as a numbered unified diff: every line is printed with its explicit old and new line numbers, file headers carry a fileId, hunk headers carry a hunkId.",
	].join("\n");
}

function instruction(): string {
	return [
		"Produce the comprehension object described by the output schema:",
		"an intent map (a summary of what this change is trying to do, the change grouped into named clusters of related work, and the file to start reading from),",
		"a guided walkthrough (ordered steps, each narrating the hunks it focuses on, in the order a reviewer should read them),",
		"explanations anchored to specific lines (each one intent, mechanism, or implication — never a review comment),",
		"and per-hunk risk scores from 2 to 5 for only the hunks that warrant more than baseline attention.",
		"Reference files by path and hunks by their printed hunkId; anchor with the printed line numbers.",
	].join("\n");
}
