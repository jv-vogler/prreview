import type { TicketHint } from "../domain/analysis/discoverTicket";
import { topicGranularity } from "../domain/analysis/topicGranularity";
import type { Understanding } from "../domain/analysis/Understanding";
import { buildUnderstanding } from "../domain/analysis/Understanding";
import type { ChangesetRef } from "../domain/changeset/ChangesetRef";
import type { ChangesetSource } from "../domain/changeset/ChangesetSource";
import type { FileDiff } from "../domain/changeset/FileDiff";
import type { EngineErrorReason } from "../domain/errors/EngineError";
import { EngineError } from "../domain/errors/EngineError";
import type { RunMeta } from "../domain/session/RunMeta";
import type { SessionManifest } from "../domain/session/SessionManifest";
import { ANALYSIS_TIMEOUT_MS } from "./analysis/limits";
import { buildUnderstandingOutSchema } from "./analysis/understandingSchemas";
import { buildUnderstandingTask } from "./analysis/understandingTask";
import { consumeEngineRun } from "./consumeEngineRun";
import type {
	Engine,
	EngineRunFailure,
	EngineRunSuccess,
	TaskInput,
	TaskSpec,
} from "./ports/Engine";
import type { PublishEvent } from "./ports/EventPublisher";
import type { Git } from "./ports/Git";
import type {
	EnqueueResult,
	RunContext,
	RunManager,
	RunOutcome,
} from "./ports/RunManager";
import type { SessionStore } from "./ports/SessionStore";

/** the analysis lane's only task type in M2 (§7 stage A) */
export const COMPREHENSION_TASK_TYPE = "comprehension";

/**
 * The structural slice of the engine-workspace service this use-case needs
 * (infrastructure/engine/workspace implements it). Declared here so the
 * application layer keeps talking to shapes, not to adapters.
 */
export interface AnalysisWorkspaces {
	ensure(request: {
		source: ChangesetSource;
		headSha: string | null;
	}): Promise<{ dir: string }>;
}

export interface RunAnalysisDeps {
	/** null when the boot probe found no agent CLI (REQ-004) */
	engine: Engine | null;
	runManager: RunManager;
	workspaces: AnalysisWorkspaces;
	git: Git;
	store: SessionStore;
	publish: PublishEvent;
}

export interface RunAnalysisInput {
	manifest: SessionManifest;
	roundId: string;
	ref: ChangesetRef;
	files: readonly FileDiff[];
	/** discovered opportunistically at open time; absent is normal, not a gap */
	ticket?: TicketHint | null;
}

export type RunAnalysis = (input: RunAnalysisInput) => Promise<EnqueueResult>;

/**
 * Stage A on demand (ARCHITECTURE §7): prepare a workspace holding the code at
 * the reviewed revision, build the comprehension task, and hand it to the
 * analysis lane. In plain terms: this is what the Analyze button does. It
 * returns as soon as the run is queued — the answer arrives over SSE, because a
 * comprehension pass takes minutes.
 *
 * Everything past the queue point runs inside the lane's job, which reports
 * failure by returning it: the run manager turns that into `run.failed`
 * (GUD-001), so a broken agent never becomes an unhandled rejection.
 */
export function makeRunAnalysis(deps: RunAnalysisDeps): RunAnalysis {
	return async (input) => {
		const engine = requireEngine(deps.engine);
		const workspace = await deps.workspaces.ensure({
			source: input.ref.source,
			headSha: input.ref.headSha,
		});
		const { task, input: taskInput } = buildUnderstandingTask({
			ref: input.ref,
			files: input.files,
			roundId: input.roundId,
			workspaceDir: workspace.dir,
			ticket: input.ticket ?? null,
		});

		return deps.runManager.enqueue({
			lane: "analysis",
			taskType: COMPREHENSION_TASK_TYPE,
			timeoutMs: ANALYSIS_TIMEOUT_MS,
			job: (context) =>
				runComprehension({ deps, input, context, engine, task, taskInput }),
		});
	};
}

function requireEngine(engine: Engine | null): Engine {
	if (engine === null) {
		throw new EngineError(
			"agent-missing",
			"No agent CLI was found, so prreview cannot analyze this change. Install and authenticate the claude CLI, then restart prreview.",
		);
	}
	return engine;
}

interface ComprehensionRun {
	deps: RunAnalysisDeps;
	input: RunAnalysisInput;
	context: RunContext;
	engine: Engine;
	task: TaskSpec;
	taskInput: TaskInput;
}

async function runComprehension(run: ComprehensionRun): Promise<RunOutcome> {
	const startedAt = nowIso();
	const consumed = await consumeEngineRun(
		run.engine.runTask(run.task, run.taskInput),
		{ signal: run.context.signal },
	);
	const sessionSoFar = {
		engineSessionId: consumed.session?.sessionId ?? "",
		model: consumed.session?.model ?? "",
	};

	const failRun = async (
		status: string,
		reason: EngineErrorReason,
		message: string,
	): Promise<RunOutcome> => {
		await recordRun(run, {
			stage: COMPREHENSION_TASK_TYPE,
			...sessionSoFar,
			startedAt,
			endedAt: nowIso(),
			status,
			reason,
		});
		return { ok: false, reason, message };
	};

	if (consumed.aborted) {
		// the manager already knows why it stopped; the record only has to say
		// that the run existed and did not finish
		return failRun("cancelled", "crashed", "The analysis run was stopped.");
	}
	const result = consumed.result;
	if (result === null) {
		return failRun(
			"failed",
			"crashed",
			"The agent stopped before it produced a result.",
		);
	}
	if (!result.ok) {
		return failRun("failed", result.reason, failureMessage(result));
	}

	const understanding = parseUnderstanding(run, result.structuredOutput);
	if (understanding === null) {
		return failRun(
			"failed",
			"schema-violation",
			"The agent's answer did not match the understanding schema, so nothing was applied.",
		);
	}

	await applyUnderstanding(run, {
		understanding,
		result,
		runId: run.context.runId,
	});
	await recordRun(
		run,
		{
			stage: COMPREHENSION_TASK_TYPE,
			engineSessionId: result.sessionId,
			model: result.model,
			startedAt,
			endedAt: nowIso(),
			costUsd: result.costUsd,
			numTurns: result.numTurns,
			status: "succeeded",
		},
		result.sessionId,
	);
	return { ok: true, skippedAnchors: 0 };
}

interface AppliedUnderstanding {
	understanding: Understanding;
	result: EngineRunSuccess;
	runId: string;
}

/**
 * Persist what the pass understood, then tell every open client it landed.
 *
 * Stage A produces **no annotations**. Explanations used to be materialized
 * into per-hunk notes hanging in the diff margin; they are now narration
 * attached to a topic and rendered on the Understanding tab, where a reader can
 * see the code a claim is about instead of hunting for it. The margin is
 * reserved for findings — things you might actually say to the author.
 */
async function applyUnderstanding(
	run: ComprehensionRun,
	applied: AppliedUnderstanding,
): Promise<void> {
	const { deps, input } = run;

	await deps.store.saveRoundAnalysis(
		input.manifest.changesetId,
		input.roundId,
		{
			understanding: applied.understanding,
			readLog: applied.result.readLog,
			runId: applied.runId,
			engineSessionId: applied.result.sessionId,
		},
	);

	deps.publish({ type: "understanding.updated", roundId: input.roundId });
}

/**
 * Appends the run's metadata to its round and, on success, records the session
 * later stages and the chat lane resume from (§7's staged pipeline). The
 * manifest is re-read first: minutes passed since the run was queued.
 */
async function recordRun(
	run: ComprehensionRun,
	meta: RunMeta,
	analysisSessionId?: string,
): Promise<void> {
	const { deps, input } = run;
	const stored =
		(await deps.store.loadSessionManifest(input.manifest.changesetId)) ??
		input.manifest;
	const updated: SessionManifest = {
		...stored,
		rounds: stored.rounds.map((round) =>
			round.id === input.roundId
				? { ...round, runs: [...round.runs, meta] }
				: round,
		),
		engine:
			analysisSessionId === undefined
				? stored.engine
				: { ...stored.engine, analysisSessionId },
	};
	await deps.store.saveSessionManifest(updated);
}

/**
 * Re-validates the agent's output against the same schema it was handed, then
 * turns the draft into the persisted shape — ids assigned, `basis` stamped from
 * what prreview discovered rather than what the agent claims, and the
 * unaccounted-for hunks derived.
 *
 * The schema is rebuilt from the round's own granularity so the cap that
 * validates is the cap that was requested.
 */
function parseUnderstanding(
	run: ComprehensionRun,
	structuredOutput: unknown,
): Understanding | null {
	const schema = buildUnderstandingOutSchema(topicGranularity(run.input.files));
	const parsed = schema.safeParse(structuredOutput);
	if (!parsed.success) {
		return null;
	}
	return buildUnderstanding({
		draft: parsed.data,
		files: run.input.files,
		ticket: run.input.ticket ?? null,
	});
}

/**
 * The most useful sentence available, not the most machine-shaped one.
 *
 * `terminalReason` used to win here, which meant a run that failed with a
 * perfectly clear explanation ("There's an issue with the selected model…")
 * reported the bare token `api_error` instead and threw the sentence away. The
 * explanation comes first now; the token is the fallback when there is nothing
 * better.
 */
function failureMessage(result: EngineRunFailure): string {
	const explanation = lastLine(result.stderrTail);
	const detail =
		explanation === "" ? (result.terminalReason ?? "") : explanation;
	return detail === ""
		? `The analysis run failed (${result.reason}).`
		: `The analysis run failed (${result.reason}): ${detail}`;
}

function lastLine(text: string): string {
	const lines = text.trimEnd().split("\n");
	return lines[lines.length - 1]?.trim() ?? "";
}

function nowIso(): string {
	return new Date().toISOString();
}
