import type { ChangesetDto } from "@dto/ChangesetDto";
import { ChangesetHeading } from "../view/diff/ChangesetHeading";
import styles from "./ReviewPage.module.css";

export interface ReviewHeaderProps {
	changeset: ChangesetDto;
	aiAvailable: boolean;
	viewedCount: number;
	fileCount: number;
	explanationCount: number;
	showExplanations: boolean;
	onToggleExplanations(): void;
	reviewDisabled: boolean;
	onReview(): void;
	errors: readonly (string | null)[];
}

export function ReviewHeader({
	changeset,
	aiAvailable,
	viewedCount,
	fileCount,
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
					{fileCount > 0 && (
						<span
							className={styles.viewedCount}
							data-viewed-count={viewedCount}
						>
							{viewedCount} of {fileCount} files viewed
						</span>
					)}
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
