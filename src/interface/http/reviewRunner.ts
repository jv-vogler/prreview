import type { PublishEvent } from "../../application/ports/EventPublisher";
import type { RunManager } from "../../application/ports/RunManager";
import { REVIEW_IDLE_TIMEOUT_MS } from "../../application/review/limits";
import { buildReviewJob } from "../../application/review/runReview";
import type { Container } from "../../container";
import { changesetIdFor } from "../../domain/changeset/ChangesetId";
import { createRunManager } from "../../infrastructure/engine/runManager";
import type { RunDto } from "./dto/RunDto";
import type { ReviewState } from "./reviewState";
import { toRunDto } from "./toRunDto";

/**
 * The HTTP edge's view of one review run: a thin adapter over the run
 * manager and the container's ports, shaped exactly to what
 * `routes/review.ts` needs (TASK-035). `start()` answers `"agent-missing"`
 * rather than throwing — no `claude` on this machine is an ordinary,
 * expected outcome (REQ-009), not a server bug.
 */
export interface ReviewRunner {
	start(): StartReviewResult;
	/** cancels the current run, if there is one; false when there is nothing to cancel */
	cancelCurrent(): boolean;
	current(): RunDto | null;
	/**
	 * Residue SEC-003's honesty measure found (TASK-030): files the last
	 * successful run left behind on the tree. Null when there is no
	 * succeeded run to report on.
	 */
	currentResidue(): Promise<string[] | null>;
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
		start() {
			if (container.engine === null) {
				return { kind: "agent-missing" };
			}
			const changeset = state.current();
			const job = buildReviewJob(
				{
					engine: container.engine,
					git: container.git,
					sessionStore: container.sessionStore,
					report: runManager.report,
				},
				{
					changesetId: changesetIdFor(changeset.ref.source),
					announce: changeset.announce.resolved,
					files: changeset.files,
				},
			);
			const result = runManager.start(job, REVIEW_IDLE_TIMEOUT_MS);
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

		async currentResidue() {
			const run = runManager.current();
			if (run === null || run.status !== "succeeded") {
				return null;
			}
			const changesetId = changesetIdFor(state.current().ref.source);
			const stored = await container.sessionStore.loadReview(changesetId);
			return stored?.residue ?? null;
		},
	};
}
