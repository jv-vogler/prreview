import type { PassFreshnessDto } from "@dto/ReviewDto";
import { useEffect, useRef } from "react";
import styles from "./ReReviewDialog.module.css";

export interface ReReviewDialogProps {
	freshness: PassFreshnessDto | null;
	worktree: boolean;
	editedCount: number;
	dismissedCount: number;
	pendingReviewUrl: string | null;
	onConfirm(options: { full: boolean }): void;
	onCancel: () => void;
}

export function ReReviewDialog({
	freshness,
	worktree,
	editedCount,
	dismissedCount,
	pendingReviewUrl,
	onConfirm,
	onCancel,
}: ReReviewDialogProps) {
	const cancelRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		cancelRef.current?.focus();
	}, []);

	const curation = curationLine(editedCount, dismissedCount);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-dismiss, with Escape as the keyboard path on the same element
		<div
			className={styles.backdrop}
			onClick={(event) => {
				if (event.target === event.currentTarget) {
					onCancel();
				}
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					onCancel();
				}
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="re-review-title"
				className={styles.dialog}
			>
				<h2 id="re-review-title" className={styles.title}>
					Review again?
				</h2>
				<p className={styles.fact}>{factLine(freshness, worktree)}</p>
				<ul className={styles.consequences}>
					<li>
						The stored pass is replaced when the new run succeeds. A failed run
						keeps it.
					</li>
					<li>
						Only the files that have moved are read again. Findings on the rest
						are carried across, marked as not re-checked. Review everything
						again to have the whole change looked at.
					</li>
					{curation !== null && <li>{curation}</li>}
					{pendingReviewUrl !== null && (
						<li>
							Your{" "}
							<a href={pendingReviewUrl} target="_blank" rel="noreferrer">
								pending review on GitHub
							</a>{" "}
							stays put; the next publish will replace it.
						</li>
					)}
				</ul>
				<div className={styles.buttons}>
					<button
						ref={cancelRef}
						type="button"
						className={styles.cancelButton}
						onClick={onCancel}
					>
						Keep the current review
					</button>
					<button
						type="button"
						className={styles.secondaryButton}
						onClick={() => onConfirm({ full: true })}
					>
						Review everything again
					</button>
					<button
						type="button"
						className={styles.confirmButton}
						onClick={() => onConfirm({ full: false })}
					>
						Review what changed
					</button>
				</div>
			</div>
		</div>
	);
}

function factLine(
	freshness: PassFreshnessDto | null,
	worktree: boolean,
): string {
	if (freshness?.kind === "same-commit") {
		return "This change was already reviewed at this exact commit.";
	}
	if (freshness?.kind === "new-commits") {
		const plural = freshness.count === 1 ? "" : "s";
		return `The change has moved: ${freshness.count} new commit${plural} since the last review.`;
	}
	return worktree
		? "This working tree was already reviewed. It may have changed since."
		: "This change was already reviewed.";
}

function curationLine(edited: number, dismissed: number): string | null {
	const parts = [
		edited > 0 ? `${edited} edited comment${edited === 1 ? "" : "s"}` : null,
		dismissed > 0
			? `${dismissed} dismissed comment${dismissed === 1 ? "" : "s"}`
			: null,
	].filter((part) => part !== null);
	if (parts.length === 0) {
		return null;
	}
	return `Your curation (${parts.join(", ")}) is handed to the new run as prior notes.`;
}
