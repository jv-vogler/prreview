import { describeToolActivity } from "../domain/analysis/RunProgress";
import type { ChangesetRef } from "../domain/changeset/ChangesetRef";
import type { ChangesetSource } from "../domain/changeset/ChangesetSource";
import type { FileDiff } from "../domain/changeset/FileDiff";
import { EngineError } from "../domain/errors/EngineError";
import { toRepoRelativeLog } from "../domain/review/groundingGate";
import type { ReviewDepth } from "../domain/review/ReviewDepth";
import type { RunMeta } from "../domain/session/RunMeta";
import type { SessionManifest } from "../domain/session/SessionManifest";
import { ANALYSIS_IDLE_TIMEOUT_MS } from "./analysis/limits";
import { consumeEngineRun } from "./consumeEngineRun";
import {
	type AnnotationDraft,
	materializeAnnotations,
} from "./materializeAnnotations";
import type { Engine } from "./ports/Engine";
import type { PublishEvent } from "./ports/EventPublisher";
import type { Git } from "./ports/Git";
import type {
	EnqueueResult,
	RunContext,
	RunManager,
	RunOutcome,
} from "./ports/RunManager";
import type { SessionStore } from "./ports/SessionStore";
import {
	type AdjudicatedFinding,
	adjudicate,
	type LensResult,
} from "./review/adjudicate";
import { readFrameSources } from "./review/frameSources";
import { buildProjectFrame } from "./review/projectFrame";
import { buildReviewOutSchema, type ReviewOut } from "./review/reviewSchemas";
import { buildLensTask } from "./review/reviewTask";

export const REVIEW_TASK_TYPE = "review";

export interface RunReviewDeps {
	engine: Engine | null;
	/** the reviewer's own guidelines, loaded once at boot (`--brain`) */
	brain?: {
		text: string;
		manifest: { source: string; sha256: string; mode: string };
	};
	runManager: RunManager;
	workspaces: {
		ensure(request: {
			source: ChangesetSource;
			headSha: string | null;
		}): Promise<{ dir: string }>;
	};
	git: Git;
	store: SessionStore;
	publish: PublishEvent;
}

export interface RunReviewInput {
	manifest: SessionManifest;
	roundId: string;
	ref: ChangesetRef;
	files: readonly FileDiff[];
	depth: ReviewDepth;
}

export type RunReview = (input: RunReviewInput) => Promise<EnqueueResult>;

/**
 * The findings pass.
 *
 * **The fan-out lives inside one run, not in a widened lane.** The job awaits
 * its lens children behind a semaphore, so the run manager still sees one
 * `runId`, one 202, one cancel, and one abort signal — which means the lane
 * policy, the single-flight collapse, and the 409 path all keep working
 * untouched. Widening the lane to five would have meant teaching every one of
 * those about a new shape of concurrency for no gain.
 */
export function makeRunReview(deps: RunReviewDeps): RunReview {
	return async (input) => {
		const engine = requireEngine(deps.engine);
		const workspace = await deps.workspaces.ensure({
			source: input.ref.source,
			headSha: input.ref.headSha,
		});

		return deps.runManager.enqueue({
			lane: "analysis",
			taskType: REVIEW_TASK_TYPE,
			idleTimeoutMs: ANALYSIS_IDLE_TIMEOUT_MS,
			job: (context) =>
				runLenses({
					deps,
					input,
					context,
					engine,
					workspaceDir: workspace.dir,
				}),
		});
	};
}

function requireEngine(engine: Engine | null): Engine {
	if (engine === null) {
		throw new EngineError(
			"agent-missing",
			"No agent CLI was found, so prreview cannot review this change. Install and authenticate the claude CLI, then restart prreview.",
		);
	}
	return engine;
}

interface ReviewRun {
	deps: RunReviewDeps;
	input: RunReviewInput;
	context: RunContext;
	engine: Engine;
	workspaceDir: string;
}

async function runLenses(run: ReviewRun): Promise<RunOutcome> {
	const startedAt = nowIso();
	const { deps, input } = run;

	/*
	 * Stage 0, and the cheapest quality lever in the pipeline: what this repo is
	 * and what it already checks automatically.
	 *
	 * Read here rather than accepted as an argument. It *was* an optional input,
	 * and the route never passed it, so `detectTooling("")` returned nothing and
	 * the "do not report anything these tools already catch" section shipped in
	 * no preset at all — while the module claiming it shipped in every one sat
	 * right next to it. An argument a caller can forget is the shape of that
	 * bug; a read the run performs itself is not.
	 */
	const frame = buildProjectFrame({
		...(await readFrameSources(deps, { ref: input.ref, files: input.files })),
		files: input.files,
	});

	// dismissed findings are the suppression list: raising one the reviewer
	// already rejected teaches them to stop reading the list entirely
	const existing = await deps.store.loadAnnotations(input.manifest.changesetId);
	const suppressions = existing
		.filter((annotation) => annotation.curation?.state === "dismissed")
		.map((annotation) => annotation.title ?? annotation.body.slice(0, 120));

	const analysis = await deps.store.loadRoundAnalysis(
		input.manifest.changesetId,
		input.roundId,
	);
	const resumeSessionId = analysis?.engineSessionId ?? null;

	/*
	 * The fan-out is one run to the manager, which is right for cancellation and
	 * wrong for the reader: without this counter a five-lens review looks like a
	 * single opaque wait. `parts` is how many readings are finished, so a slow
	 * pass still visibly advances.
	 */
	let lensesDone = 0;
	const reportParts = () =>
		deps.runManager.report(run.context.runId, {
			kind: "parts",
			done: lensesDone,
			total: input.depth.lenses.length,
		});
	reportParts();

	const results = await mapWithLimit(
		input.depth.lenses,
		input.depth.parallelChildren,
		async (lens): Promise<LensResult | null> => {
			if (run.context.signal.aborted) {
				return null;
			}
			const { task, input: taskInput } = buildLensTask({
				lens,
				depth: input.depth,
				frame,
				...(deps.brain === undefined ? {} : { brain: deps.brain }),
				ref: input.ref,
				files: input.files,
				roundId: input.roundId,
				workspaceDir: run.workspaceDir,
				resumeSessionId,
				suppressions,
			});
			const consumed = await consumeEngineRun(
				run.engine.runTask(task, taskInput),
				{
					signal: run.context.signal,
					onTool: (event) =>
						deps.runManager.report(run.context.runId, {
							kind: "activity",
							// the lens is named because five children read in parallel
							// and "Reading src/api.ts" alone would look like one agent
							// jumping around at random
							activity: `${lens}: ${describeToolActivity(event.name, event.target)}`,
						}),
				},
			);
			lensesDone += 1;
			reportParts();
			const result = consumed.result;
			if (consumed.aborted || result === null || !result.ok) {
				// one lens failing is not the run failing: five readings minus one
				// is still a review, and refusing to show four good findings
				// because a fifth child timed out would be the wrong trade
				return null;
			}
			const parsed = buildReviewOutSchema(input.depth).safeParse(
				result.structuredOutput,
			);
			if (!parsed.success) {
				return null;
			}
			// the log is passed through whole: it carries the ranges now, and
			// flattening them is what made the gate's `outside-read-range`
			// verdict unreachable
			return { lens, out: parsed.data as ReviewOut, readLog: result.readLog };
		},
	);

	const usable = results.filter(
		(result): result is LensResult => result !== null,
	);
	if (run.context.signal.aborted) {
		await recordRun(run, {
			stage: REVIEW_TASK_TYPE,
			engineSessionId: resumeSessionId ?? "",
			model: "",
			startedAt,
			endedAt: nowIso(),
			status: "cancelled",
			reason: "crashed",
		});
		return { ok: false, reason: "crashed", message: "The review was stopped." };
	}
	if (usable.length === 0) {
		await recordRun(run, {
			stage: REVIEW_TASK_TYPE,
			engineSessionId: resumeSessionId ?? "",
			model: "",
			startedAt,
			endedAt: nowIso(),
			status: "failed",
			reason: "crashed",
		});
		return {
			ok: false,
			reason: "crashed",
			message: "Every lens failed, so there is nothing to show.",
		};
	}

	const adjudicated = adjudicate({
		results: usable,
		depth: input.depth,
		files: input.files,
		workspaceDir: run.workspaceDir,
	});

	const { annotations, skippedAnchors } = await materializeAnnotations(
		{ git: deps.git, store: deps.store },
		{
			drafts: [
				...adjudicated.findings.map((finding) => toDraft(finding, "finding")),
				...adjudicated.relatedFindings.map((finding) =>
					toDraft(finding, "related-finding"),
				),
			],
			files: input.files,
			provenance: {
				roundId: input.roundId,
				stage: REVIEW_TASK_TYPE,
				engineSessionId: resumeSessionId ?? "",
			},
			createdAt: nowIso(),
		},
	);

	// a re-review replaces the previous pass's findings rather than stacking a
	// second copy of every one; explanations are not ours to touch
	const kept = existing.filter(
		(annotation) =>
			annotation.species !== "finding" &&
			annotation.species !== "related-finding",
	);
	const superseded = existing.filter(
		(annotation) =>
			annotation.species === "finding" ||
			annotation.species === "related-finding",
	);
	await deps.store.saveAnnotations(input.manifest.changesetId, [
		...kept,
		...annotations,
	]);
	for (const annotation of superseded) {
		deps.publish({ type: "annotation.removed", id: annotation.id });
	}
	for (const annotation of annotations) {
		deps.publish({ type: "annotation.upserted", annotation });
	}
	/*
	 * What the pass decided, beyond the annotations it produced.
	 *
	 * Written before the event that tells clients to look, so a client that
	 * refetches immediately cannot beat the record it is refetching. The read
	 * log is stored repo-relative: for a PR the workspace is a cache directory
	 * named after a head sha, which is released at shutdown, so paths relative
	 * to it would be unusable by the time anything read them back.
	 */
	await deps.store.saveRoundReview(input.manifest.changesetId, input.roundId, {
		discarded: adjudicated.discarded,
		skippedAnchors,
		readLog: toRepoRelativeLog(adjudicated.readLog, run.workspaceDir),
		runId: run.context.runId,
		producedAt: nowIso(),
	});

	deps.publish({ type: "findings.updated", roundId: input.roundId });

	await recordRun(run, {
		stage: REVIEW_TASK_TYPE,
		engineSessionId: resumeSessionId ?? "",
		model: "",
		startedAt,
		endedAt: nowIso(),
		status: "succeeded",
	});
	/*
	 * Both losses ride the outcome, which is what puts them in the terminal.
	 *
	 * `skippedAnchors` was hardcoded to 0 while `materializeAnnotations` was
	 * returning a real count, so a finding whose anchor named nothing placeable
	 * vanished without a word anywhere. The discard count is the same kind of
	 * fact and travels the same way.
	 */
	return {
		ok: true,
		skippedAnchors,
		discardedCandidates: adjudicated.discarded.length,
	};
}

/**
 * Runs `work` over `items`, at most `limit` at a time.
 *
 * The semaphore is what keeps the fan-out inside one run: five children in
 * flight with one abort signal between them, rather than five runs the manager
 * would have to reason about.
 */
async function mapWithLimit<Item, Result>(
	items: readonly Item[],
	limit: number,
	work: (item: Item) => Promise<Result>,
): Promise<Result[]> {
	const results: Result[] = new Array(items.length);
	let next = 0;

	async function worker(): Promise<void> {
		while (next < items.length) {
			const index = next++;
			const item = items[index];
			if (item === undefined) {
				continue;
			}
			results[index] = await work(item);
		}
	}

	await Promise.all(
		Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
	);
	return results;
}

async function recordRun(run: ReviewRun, meta: RunMeta): Promise<void> {
	const { deps, input } = run;
	const stored =
		(await deps.store.loadSessionManifest(input.manifest.changesetId)) ??
		input.manifest;
	await deps.store.saveSessionManifest({
		...stored,
		rounds: stored.rounds.map((round) =>
			round.id === input.roundId
				? { ...round, runs: [...round.runs, meta] }
				: round,
		),
	});
}

function nowIso(): string {
	return new Date().toISOString();
}

/**
 * Everything adjudication decided, carried onto the stored annotation.
 *
 * "Everything" is the point of this function, and it used to carry four of the
 * seven things it was handed. `groundingVerified` says the gate ran; `marks`
 * say *what* it found, which is the difference between "treat as a lead" and
 * "cites a file nobody opened"; `citations` are what a later reword is
 * re-grounded against, so dropping them left a rewrite checked against its
 * anchor alone; and `reproTest` is an artifact the prompt promises the reader.
 * A check whose answer is computed and then dropped is the same as no check.
 */
function toDraft(
	finding: AdjudicatedFinding,
	species: "finding" | "related-finding",
): AnnotationDraft {
	return {
		anchor: finding.anchor,
		body: finding.body,
		species,
		category: finding.category,
		title: finding.title,
		severity: finding.severity,
		groundingVerified: finding.groundingVerified,
		proof: { mode: finding.proof.mode, how: finding.proof.how },
		confidence: confidenceBand(finding.confidence),
		...(finding.citations.length === 0 ? {} : { citations: finding.citations }),
		...(finding.marks.length === 0 ? {} : { marks: finding.marks }),
		...(finding.reproTest === undefined
			? {}
			: { reproTest: finding.reproTest }),
	};
}

/**
 * The schema's 0–100 becomes the three bands the UI and the store speak.
 *
 * The thresholds sit above the 80 floor every preset enforces, so the bands
 * describe what actually survives rather than a range that cannot occur.
 */
function confidenceBand(confidence: number): "high" | "medium" | "low" {
	if (confidence >= 90) {
		return "high";
	}
	return confidence >= 80 ? "medium" : "low";
}
