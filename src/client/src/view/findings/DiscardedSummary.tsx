import type { ReviewSummaryDto } from "@dto/ReviewSummaryDto";
import styles from "./DiscardedSummary.module.css";
import { discardReasonCopy, discardReasonHeading } from "./discardReasonCopy";

/**
 * What the pass threw away, collapsed.
 *
 * Every number in here was computed and then dropped, which is why it exists:
 * a reader saw six comments with no way to know that ten candidates went in and
 * four were cut, and "the gates are working" is not a claim anyone could check.
 *
 * Collapsed rather than absent, and collapsed rather than open: the discards are
 * evidence about the pass, not a second list of comments to read. Titles are
 * shown and bodies are not — a body that failed the form gate is exactly the
 * noise the gate removed.
 */
export interface DiscardedSummaryProps {
	summary: ReviewSummaryDto;
}

export function DiscardedSummary({ summary }: DiscardedSummaryProps) {
	const { discardedTotal, skippedAnchors } = summary;
	if (discardedTotal === 0 && skippedAnchors === 0) {
		return null;
	}

	return (
		<details className={styles.discarded} data-discarded-summary>
			<summary className={styles.summary}>
				{discardedTotal > 0
					? `${discardedTotal} ${discardedTotal === 1 ? "candidate" : "candidates"} didn't make the cut`
					: "Some findings could not be placed"}
			</summary>

			<div className={styles.body}>
				{summary.discarded.map((group) => (
					<section key={group.reason} className={styles.group}>
						<h3 className={styles.heading}>
							{discardReasonHeading(group.reason)}{" "}
							<span className={styles.count}>{group.count}</span>
						</h3>
						<p className={styles.why}>{discardReasonCopy(group.reason)}</p>
						<ul className={styles.titles}>
							{group.examples.map((title) => (
								<li key={title}>{title}</li>
							))}
							{group.count > group.examples.length && (
								<li className={styles.more}>
									and {group.count - group.examples.length} more
								</li>
							)}
						</ul>
					</section>
				))}

				{/*
					A different kind of loss, and one that used to be reported
					nowhere at all: the finding was good enough to keep and named
					lines this diff does not have, so there was nowhere to put it.
				*/}
				{skippedAnchors > 0 && (
					<section className={styles.group}>
						<h3 className={styles.heading}>
							Could not be placed{" "}
							<span className={styles.count}>{skippedAnchors}</span>
						</h3>
						<p className={styles.why}>
							Anchored on lines this diff does not contain. A comment in the
							wrong place is worse than a comment that is missing.
						</p>
					</section>
				)}
			</div>
		</details>
	);
}
