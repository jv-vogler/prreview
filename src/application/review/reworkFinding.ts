import {
	REWORK_IDLE_TIMEOUT_MS,
	REWORK_MAX_TURNS,
} from "../../domain/agentTask/limits";
import { reworkContract } from "../../domain/agentTask/reviewContract";
import {
	buildReworkPrompt,
	type ReworkInstruction,
	reworkResultSchema,
} from "../../domain/agentTask/reworkPrompt";
import {
	assertSchemaFitsArgv,
	toJsonSchema,
} from "../../domain/agentTask/toJsonSchema";
import type { ChangesetId } from "../../domain/changeset/ChangesetId";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { effectiveBody, isDeleted } from "../../domain/finding/curation";
import { findingIndexFor } from "../../domain/finding/findingId";
import type { ReviewFinding } from "../../domain/pass/ReviewPass";
import type { FindingEdit } from "../../domain/pass/StoredReview";
import type { RunProgressUpdate } from "../../domain/run/RunProgress";
import type { Engine } from "../ports/Engine";
import type { Git } from "../ports/Git";
import type { RunContext, RunJob, RunOutcome } from "../ports/RunManager";
import type { SessionStore } from "../ports/SessionStore";
import { runEngineTask } from "./runEngineTask";

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
