import type { ReworkInstructionDto } from "@dto/ReviewDto";
import type { RunDto } from "@dto/RunDto";
import { REVIEW_FAILURE_COPY } from "../run/reviewFailureCopy";

export interface ReworkProposal {
	findingId: string;
	status: "running" | "succeeded" | "failed";
	proposedBody?: string;
	errorMessage?: string;
}

export interface FindingActions {
	onEdit(findingId: string, body: string): void;
	onDelete(findingId: string): void;
	onRestore(findingId: string): void;
	onRework?(findingId: string, instruction: ReworkInstructionDto): void;
	reworkProposal: ReworkProposal | null;
	onAcceptRework(findingId: string, body: string): void;
	onDismissRework(): void;
}

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
