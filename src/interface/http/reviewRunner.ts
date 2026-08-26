import type { PublishEvent } from "../../application/ports/EventPublisher";
import type { RunManager } from "../../application/ports/RunManager";
import { assessPassFreshness } from "../../application/review/passFreshness";
import type { ReworkInstruction } from "../../application/review/reworkFinding";
import { buildReworkJob } from "../../application/review/reworkFinding";
import { buildReviewJob } from "../../application/review/runReview";
import type { Container } from "../../container";
import {
	REVIEW_IDLE_TIMEOUT_MS,
	REWORK_IDLE_TIMEOUT_MS,
} from "../../domain/agentTask/limits";
import { changesetIdFor } from "../../domain/changeset/ChangesetId";
import { createRunManager } from "../../infrastructure/engine/runManager";
import type { PassFreshnessDto, ReviewPassDto } from "./dto/ReviewDto";
import type { ReviewStatusDto, RunDto } from "./dto/RunDto";
import type { ReviewState } from "./reviewState";
import { toReviewPassDto } from "./toReviewPassDto";
import { toRunDto } from "./toRunDto";

/**
 * The HTTP edge's view of one review run: a thin adapter over the run
 * manager and the container's ports, shaped exactly to what
 * `routes/review.ts` needs (TASK-035). `start()`/`startRework()` answer
 * `"agent-missing"` rather than throwing — no `claude` on this machine is an
 * ordinary, expected outcome (REQ-009), not a server bug.
 */
export interface StartReviewOptions {
	/**
	 * Look at the whole change again rather than only what moved since the
	 * stored pass. The reader's way out of a delta pass, never a fallback
	 * the code takes on its own.
	 */
	full?: boolean;
}

export interface ReviewRunner {
	start(options?: StartReviewOptions): StartReviewResult;
	/**
	 * A rework shares the same one-run-at-a-time lane as a full pass
	 * (TASK-048) — starting one while either is active answers `"conflict"`
	 * exactly like `start()` does.
	 */
	startRework(
		findingId: string,
		instruction: ReworkInstruction,
	): StartReviewResult;
	/** cancels the current run, if there is one; false when there is nothing to cancel */
	cancelCurrent(): boolean;
	current(): RunDto | null;
	/**
	 * The last completed pass for the reviewed changeset, read straight from
	 * the store — deliberately independent of `current()`'s run bookkeeping,
	 * so a pass persisted before a server restart still renders (TASK-041).
	 * Null when no pass has ever been saved for this changeset.
	 */
	currentPass(): Promise<CurrentPass | null>;
}

export interface CurrentPass {
	pass: ReviewPassDto;
	freshness: PassFreshnessDto;
}

export type StartReviewResult =
	| { kind: "started"; runId: string }
	| { kind: "conflict"; existingRunId: string }
	| { kind: "agent-missing" };

export function createReviewRunner(
	container: Container,
	state: ReviewState,
	publish: PublishEvent,
): ReviewRunner {
	const runManager: RunManager = createRunManager({ publish });

	return {
		start(options) {
			if (container.engine === null) {
				return { kind: "agent-missing" };
			}
			const changeset = state.current();
			const job = buildReviewJob(
				{
					engine: container.engine,
					git: container.git,
					sessionStore: container.sessionStore,
					githubService: container.githubService,
					report: runManager.report,
				},
				{
					changesetId: changesetIdFor(changeset.ref.source),
					announce: changeset.announce.resolved,
					files: changeset.files,
					baseSha: changeset.ref.baseSha,
					headSha: changeset.ref.headSha,
					source: changeset.ref.source,
					full: options?.full === true,
				},
			);
			const result = runManager.start(job, REVIEW_IDLE_TIMEOUT_MS, {
				kind: "review",
			});
			return result.kind === "started"
				? { kind: "started", runId: result.runId }
				: { kind: "conflict", existingRunId: result.existingRunId };
		},

		startRework(findingId, instruction) {
			if (container.engine === null) {
				return { kind: "agent-missing" };
			}
			const changeset = state.current();
			const job = buildReworkJob(
				{
					engine: container.engine,
					git: container.git,
					sessionStore: container.sessionStore,
					report: runManager.report,
				},
				{
					changesetId: changesetIdFor(changeset.ref.source),
					findingId,
					instruction,
					files: changeset.files,
				},
			);
			const result = runManager.start(job, REWORK_IDLE_TIMEOUT_MS, {
				kind: "rework",
				findingId,
			});
			return result.kind === "started"
				? { kind: "started", runId: result.runId }
				: { kind: "conflict", existingRunId: result.existingRunId };
		},

		cancelCurrent() {
			const run = runManager.current();
			return run === null ? false : runManager.cancel(run.id);
		},

		current() {
			const run = runManager.current();
			return run === null ? null : toRunDto(run);
		},

		async currentPass() {
			const changeset = state.current();
			const changesetId = changesetIdFor(changeset.ref.source);
			const stored = await container.sessionStore.loadReview(changesetId);
			if (stored === null) {
				return null;
			}
			return {
				pass: toReviewPassDto(stored, changeset.files),
				freshness: await assessPassFreshness(
					{ git: container.git },
					stored.headSha,
					changeset.ref.headSha,
				),
			};
		},
	};
}

/**
 * The run and the stored pass as one answer, the shape `GET /api/review`
 * has always had. Shared so `POST /api/changeset/refresh` cannot drift from
 * it: a refreshed changeset and the freshness read against it have to come
 * back together, or the dialog states a fact about a snapshot that is
 * already gone.
 */
export async function reviewStatusOf(
	runner: ReviewRunner,
): Promise<ReviewStatusDto> {
	const current = await runner.currentPass();
	return {
		run: runner.current(),
		pass: current?.pass ?? null,
		freshness: current?.freshness ?? null,
	};
}
