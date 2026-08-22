import type { ReworkInstructionDto } from "@dto/ReviewDto";

/**
 * One rework's status against one comment (TASK-048, TASK-049): there is at
 * most one at a time, matching the one-run-at-a-time lane it shares with a
 * full review pass.
 */
export interface ReworkProposal {
	commentId: string;
	status: "running" | "succeeded" | "failed";
	/** only set once `status` is `"succeeded"` */
	proposedBody?: string;
	/** only set once `status` is `"failed"` */
	errorMessage?: string;
}

/**
 * Every curation move a `CommentBalloon` can trigger, bundled so it threads
 * as one prop through `DiffCommentAnnotation` and `CommentWorklist` rather
 * than five (TASK-046, TASK-047, TASK-049). `onRework` is absent rather than
 * disabled when there is no agent (REQ-009) — the control does not render
 * at all.
 */
export interface CommentActions {
	onEdit(commentId: string, body: string): void;
	onDelete(commentId: string): void;
	onRework?(commentId: string, instruction: ReworkInstructionDto): void;
	reworkProposal: ReworkProposal | null;
	onAcceptRework(commentId: string, body: string): void;
	onDismissRework(): void;
}
