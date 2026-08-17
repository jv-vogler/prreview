import type { ChangesetRef } from "../domain/changeset/ChangesetRef";
import type { ChangesetSource } from "../domain/changeset/ChangesetSource";
import type { FileDiff } from "../domain/changeset/FileDiff";
import type { EngineErrorReason } from "../domain/errors/EngineError";
import { EngineError } from "../domain/errors/EngineError";
import type { RunMeta } from "../domain/session/RunMeta";
import type { SessionManifest } from "../domain/session/SessionManifest";
import { buildComprehensionTask } from "./analysis/comprehensionTask";
import { ANALYSIS_TIMEOUT_MS } from "./analysis/limits";
import {
	type ComprehensionOut,
	comprehensionOutSchema,
} from "./analysis/schemas";
import { consumeEngineRun } from "./consumeEngineRun";
import { materializeAnnotations } from "./materializeAnnotations";
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
		const { task, input: taskInput } = buildComprehensionTask({
			ref: input.ref,
			files: input.files,
			roundId: input.roundId,
			workspaceDir: workspace.dir,
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

	const comprehension = parseComprehension(result.structuredOutput);
	if (comprehension === null) {
		return failRun(
			"failed",
			"schema-violation",
			"The agent's answer did not match the comprehension schema, so nothing was applied.",
		);
	}

	const skippedAnchors = await applyComprehension(run, {
		comprehension,
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
	return { ok: true, skippedAnchors };
}

interface AppliedComprehension {
	comprehension: ComprehensionOut;
	result: EngineRunSuccess;
	runId: string;
}

/**
 * Persist the round's raw stage output, then turn its explanations into stored
 * annotations. A re-run replaces the previous explanations rather than stacking
 * a second copy on the same lines — an explanation is cheap to regenerate (§12)
 * and duplicates would be user-visible noise.
 */
async function applyComprehension(
	run: ComprehensionRun,
	applied: AppliedComprehension,
): Promise<number> {
	const { deps, input } = run;
	const changesetId = input.manifest.changesetId;

	await deps.store.saveRoundAnalysis(changesetId, input.roundId, {
		comprehension: applied.comprehension,
		readLog: applied.result.readLog,
		runId: applied.runId,
		engineSessionId: applied.result.sessionId,
	});

	const { annotations, skippedAnchors } = await materializeAnnotations(
		{ git: deps.git, store: deps.store },
		{
			explanations: applied.comprehension.explanations,
			files: input.files,
			provenance: {
				roundId: input.roundId,
				stage: COMPREHENSION_TASK_TYPE,
				engineSessionId: applied.result.sessionId,
			},
			createdAt: nowIso(),
		},
	);

	const existing = await deps.store.loadAnnotations(changesetId);
	const superseded = existing.filter(
		(annotation) => annotation.species === "explanation",
	);
	const kept = existing.filter(
		(annotation) => annotation.species !== "explanation",
	);
	await deps.store.saveAnnotations(changesetId, [...kept, ...annotations]);

	for (const annotation of superseded) {
		deps.publish({ type: "annotation.removed", id: annotation.id });
	}
	for (const annotation of annotations) {
		deps.publish({ type: "annotation.upserted", annotation });
	}
	return skippedAnchors;
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

function parseComprehension(
	structuredOutput: unknown,
): ComprehensionOut | null {
	// REQ-007's boundary is enforced in the adapter; parsing again is what turns
	// `unknown` into the typed object, and costs nothing.
	const parsed = comprehensionOutSchema.safeParse(structuredOutput);
	return parsed.success ? parsed.data : null;
}

function failureMessage(result: EngineRunFailure): string {
	const detail = result.terminalReason ?? lastLine(result.stderrTail);
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
