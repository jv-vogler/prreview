import type { ReworkInstructionDto } from "@dto/ReviewDto";
import type { RunDto } from "@dto/RunDto";
import { REVIEW_FAILURE_COPY } from "../run/reviewFailureCopy";

/**
 * One rework's status against one comment (TASK-048, TASK-049): there is at
 * most one at a time, matching the one-run-at-a-time lane it shares with a
 * full review pass.
 */
export interface ReworkProposal {
	findingId: string;
	status: "running" | "succeeded" | "failed";
	/** only set once `status` is `"succeeded"` */
	proposedBody?: string;
	/** only set once `status` is `"failed"` */
	errorMessage?: string;
}

/**
 * Every curation move a `FindingBalloon` can trigger, bundled so it threads
 * as one prop through `DiffFindingAnnotation` and `FindingWorklist` rather
 * than five (TASK-046, TASK-047, TASK-049). `onRework` is absent rather than
 * disabled when there is no agent (REQ-009) — the control does not render
 * at all.
 */
export interface FindingActions {
	onEdit(findingId: string, body: string): void;
	onDelete(findingId: string): void;
	onRestore(findingId: string): void;
	onRework?(findingId: string, instruction: ReworkInstructionDto): void;
	reworkProposal: ReworkProposal | null;
	onAcceptRework(findingId: string, body: string): void;
	onDismissRework(): void;
}

/**
 * The rework a finding should be showing, read off the run state the status
 * bar already reads. At most one rework is ever in flight, since it shares
 * the review's one-run-at-a-time lane, so this is a filter on the current
 * run rather than a lookup.
 */
export function reworkProposalFor(
	run: RunDto | null,
	dismissedRunId: string | null,
): ReworkProposal | null {
	if (
		run === null ||
		run.kind !== "rework" ||
		run.findingId === undefined ||
		run.id === dismissedRunId
	) {
		return null;
	}
	const findingId = run.findingId;
	switch (run.status) {
		case "queued":
		case "running":
			return { findingId, status: "running" };
		case "succeeded":
			return run.result === undefined
				? null
				: { findingId, status: "succeeded", proposedBody: run.result };
		case "failed":
		case "timed-out":
			return { findingId, status: "failed", errorMessage: failureCopy(run) };
		case "cancelled":
			return {
				findingId,
				status: "failed",
				errorMessage: "The rework was cancelled.",
			};
	}
}

function failureCopy(run: RunDto): string {
	return run.error === undefined
		? "The rework did not finish."
		: REVIEW_FAILURE_COPY[run.error.reason];
}
