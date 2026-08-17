import type { TicketHint } from "../../domain/analysis/discoverTicket";
import { topicGranularity } from "../../domain/analysis/topicGranularity";
import { changesetIdFor } from "../../domain/changeset/ChangesetId";
import type { ChangesetRef } from "../../domain/changeset/ChangesetRef";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { TaskInput, TaskSpec } from "../ports/Engine";
import { ANALYSIS_TIMEOUT_MS, COMPREHENSION_MAX_TURNS } from "./limits";
import { serializeNud } from "./nud";
import { comprehensionContract } from "./systemContract";
import { TOPIC_SUMMARY_MAX, TOPIC_TITLE_MAX } from "./topicSchemas";
import { toJsonSchema } from "./toJsonSchema";
import { buildUnderstandingOutSchema } from "./understandingSchemas";

export interface BuildUnderstandingTaskInput {
	ref: ChangesetRef;
	files: readonly FileDiff[];
	roundId: string;
	/** the directory holding the code at the reviewed revision */
	workspaceDir: string;
	/** discovered opportunistically; absent is normal, not a failure */
	ticket?: TicketHint | null;
}

export interface UnderstandingTask {
	task: TaskSpec;
	input: TaskInput;
}

/**
 * The comprehension pass: one run producing the topics the Understanding tab
 * renders and the orientation the Overview tab renders.
 *
 * Note what is deliberately **not** in this prompt: the PR description. The
 * Overview tab judges whether the code matches the goal, and a description is
 * the author's claim about their own work — feeding it in would make the verdict
 * a check of whether the code matches the *description of itself*, which is
 * circular and always passes. The ticket key is passed when one was found,
 * because that is an external statement of intent, and nothing is passed when
 * none was, in which case the verdict is honestly about internal coherence.
 */
export function buildUnderstandingTask(
	input: BuildUnderstandingTaskInput,
): UnderstandingTask {
	const granularity = topicGranularity(input.files);
	const schema = buildUnderstandingOutSchema(granularity);

	const prompt = [
		framing(input),
		serializeNud({
			ref: input.ref,
			roundId: input.roundId,
			files: input.files,
		}),
		instruction(input, granularity.targetTopicCount),
	].join("\n\n");

	return {
		task: {
			stage: "comprehension",
			jsonSchema: toJsonSchema(schema),
			maxTurns: COMPREHENSION_MAX_TURNS,
			timeoutMs: ANALYSIS_TIMEOUT_MS,
			systemContract: comprehensionContract(),
			outputSchema: schema,
		},
		input: { prompt, workspaceDir: input.workspaceDir },
	};
}

function framing(input: BuildUnderstandingTaskInput): string {
	const { ref, workspaceDir } = input;
	return [
		"You are helping a reviewer understand a code change.",
		`Changeset ${changesetIdFor(ref.source)}: base ${ref.baseSha}, head ${ref.headSha ?? "the working tree"}.`,
		`Your working directory, ${workspaceDir}, holds the code exactly at the reviewed revision — read it to ground every claim.`,
		"Below is the changed code as a numbered unified diff: every line is printed with its explicit old and new line numbers, file headers carry a fileId, hunk headers carry a hunkId.",
	].join("\n");
}

function instruction(
	input: BuildUnderstandingTaskInput,
	targetTopicCount: number,
): string {
	return [
		"Produce the understanding object described by the output schema.",
		"",
		`**summary** — what this change is for, in one short paragraph a reviewer meeting it for the first time could follow. Say what it accomplishes, not what files it touches.`,
		"",
		`**topics** — the change retold as roughly ${targetTopicCount} plain-language units of intent. Aim for that many; fewer is right if the change genuinely holds fewer ideas.`,
		"",
		"Each topic is one thing the change is doing, named the way a person would say it out loud, with the hunks that serve it. Rules that matter:",
		`- \`title\`: at most ${TOPIC_TITLE_MAX} characters. Name the intent ("Retry webhook delivery on 5xx"), never the mechanics ("Changes to webhook.ts").`,
		`- \`summary\`: at most ${TOPIC_SUMMARY_MAX} characters. High level, plain language, simple enough for someone new to this codebase. Say why this part exists and what it now does. Never walk through the code line by line.`,
		"- `refs`: the hunks this topic covers, by their printed hunkId. Leave `hunkIds` empty only when you mean the whole file.",
		"- **A hunk may belong to more than one topic.** If one hunk does two distinct things, list it under both. Topics are not a way of dividing the diff into non-overlapping pieces; they are a way of naming what it does.",
		"- Cover the whole change. Every hunk should appear under at least one topic unless it is genuinely incidental.",
		"",
		"**suggestedEntryPoint** — the path a reviewer should read first.",
		"",
		goalMatchInstruction(input.ticket ?? null),
	].join("\n");
}

function goalMatchInstruction(ticket: TicketHint | null): string {
	const shared = [
		"- `matches`: the code does what it set out to do.",
		"- `partly`: it does some of it, or does it plus something unrelated.",
		"- `diverges`: it does something materially different.",
		"- `unclear`: you could not determine the intent from the code. This is a real answer — give it rather than guessing.",
		"",
		"`rationale`: one or two sentences saying why, citing what you read. Do not restate the summary.",
	];

	if (ticket === null) {
		return [
			"**goalMatch** — whether this change is internally coherent: does the code accomplish the purpose the change itself implies?",
			"",
			"No ticket or external requirement was found for this change, so judge only whether the parts of the change serve one another and a single evident purpose. Do not invent a requirement to measure it against.",
			"",
			...shared,
		].join("\n");
	}

	return [
		`**goalMatch** — whether this change does what ${ticket.key} asks for.`,
		"",
		`The reference \`${ticket.key}\` was found in the ${ticket.source}. You do not have the ticket's text — do not pretend to. Judge whether the change is coherent with what that reference and the code together imply, and say plainly if you cannot tell.`,
		"",
		...shared,
	].join("\n");
}
