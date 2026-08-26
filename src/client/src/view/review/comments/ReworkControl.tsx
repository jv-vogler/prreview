import type { ReviewFindingDto, ReworkInstructionDto } from "@dto/ReviewDto";
import type { FindingActions } from "./FindingActions";
import styles from "./ReworkControl.module.css";

const INSTRUCTIONS: { instruction: ReworkInstructionDto; label: string }[] = [
	{ instruction: "concise", label: "Shorter" },
	{ instruction: "expand", label: "More detail" },
	{ instruction: "explain", label: "Explain" },
];

export function ReworkControl({
	finding,
	actions,
}: {
	finding: ReviewFindingDto;
	actions: FindingActions;
}) {
	const proposal =
		actions.reworkProposal?.findingId === finding.id
			? actions.reworkProposal
			: null;

	if (proposal?.status === "running") {
		return <p className={styles.status}>Reworking this finding…</p>;
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
							actions.onAcceptRework(finding.id, proposal.proposedBody ?? "")
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
					onClick={() => actions.onRework?.(finding.id, instruction)}
				>
					{label}
				</button>
			))}
		</div>
	);
}
