import type { ReviewCommentDto, ReworkInstructionDto } from "@dto/ReviewDto";
import type { CommentActions } from "./CommentActions";
import styles from "./ReworkControl.module.css";

const INSTRUCTIONS: { instruction: ReworkInstructionDto; label: string }[] = [
	{ instruction: "concise", label: "Shorter" },
	{ instruction: "expand", label: "More detail" },
	{ instruction: "explain", label: "Explain" },
];

/**
 * The per-comment rework control (TASK-049): three plain instructions, the
 * run's own honest status while it works (REQ-008's discipline, scoped to
 * this one comment instead of the top bar), and an explicit accept/reject
 * of the proposal — it never overwrites the comment on its own.
 */
export function ReworkControl({
	comment,
	actions,
}: {
	comment: ReviewCommentDto;
	actions: CommentActions;
}) {
	const proposal =
		actions.reworkProposal?.commentId === comment.id
			? actions.reworkProposal
			: null;

	if (proposal?.status === "running") {
		return <p className={styles.status}>Reworking this comment…</p>;
	}
	if (proposal?.status === "failed") {
		return (
			<div className={styles.status}>
				<p>{proposal.errorMessage}</p>
				<button type="button" onClick={actions.onDismissRework}>
					Dismiss
				</button>
			</div>
		);
	}
	if (proposal?.status === "succeeded" && proposal.proposedBody !== undefined) {
		return (
			<div className={styles.proposal}>
				<p className={styles.proposalLabel}>Proposed rework</p>
				<p className={styles.proposalBody}>{proposal.proposedBody}</p>
				<div className={styles.proposalActions}>
					<button
						type="button"
						onClick={() =>
							actions.onAcceptRework(comment.id, proposal.proposedBody ?? "")
						}
					>
						Use this
					</button>
					<button type="button" onClick={actions.onDismissRework}>
						Discard
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className={styles.controls}>
			{INSTRUCTIONS.map(({ instruction, label }) => (
				<button
					key={instruction}
					type="button"
					className={styles.instruction}
					onClick={() => actions.onRework?.(comment.id, instruction)}
				>
					{label}
				</button>
			))}
		</div>
	);
}
