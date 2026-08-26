import type { ChangesetDto } from "@dto/ChangesetDto";
import { ChangesetHeading } from "../view/diff/ChangesetHeading";
import styles from "./ReviewPage.module.css";

export interface ReviewHeaderProps {
	changeset: ChangesetDto;
	aiAvailable: boolean;
	explanationCount: number;
	showExplanations: boolean;
	onToggleExplanations(): void;
	reviewDisabled: boolean;
	onReview(): void;
	/** anything that went wrong, in the order it should be read; nulls ignored */
	errors: readonly (string | null)[];
}

/** What the change is, the two controls that act on it, and anything that failed. */
export function ReviewHeader({
	changeset,
	aiAvailable,
	explanationCount,
	showExplanations,
	onToggleExplanations,
	reviewDisabled,
	onReview,
	errors,
}: ReviewHeaderProps) {
	return (
		<>
			<div className={styles.headerRow}>
				<div className={styles.headerSubject}>
					<ChangesetHeading
						source={changeset.ref.source}
						resolved={changeset.announce.resolved}
						prUrl={changeset.ref.prUrl}
					/>
				</div>
				<div className={styles.controls}>
					{explanationCount > 0 && (
						<button
							type="button"
							className={styles.explanationsToggle}
							aria-pressed={showExplanations}
							onClick={onToggleExplanations}
						>
							{showExplanations ? "Hide explanations" : "Show explanations"}
						</button>
					)}
					{aiAvailable && (
						<button
							type="button"
							className={styles.reviewButton}
							disabled={reviewDisabled}
							onClick={onReview}
						>
							Review
						</button>
					)}
				</div>
			</div>
			{errors
				.filter((message) => message !== null)
				.map((message) => (
					<p key={message} className={styles.startError} role="alert">
						{message}
					</p>
				))}
		</>
	);
}
