import type { ReviewPassDto } from "@dto/ReviewDto";
import styles from "./OverviewPanel.module.css";

/**
 * The pass's own overview, above the diff (TASK-042, REQ-003): business-level
 * prose, the verdict, the ticket line and the quality points. Read once,
 * then scrolled past — it does not get a sidebar of its own.
 */
export function OverviewPanel({ pass }: { pass: ReviewPassDto }) {
	return (
		<div className={styles.panel}>
			<p className={styles.overview}>{pass.overview}</p>
			<p className={styles.verdict}>{pass.verdict}</p>
			{pass.ticket !== null && <p className={styles.ticket}>{pass.ticket}</p>}
			{pass.qualityPoints.length > 0 && (
				<div className={styles.qualityPoints}>
					<h3 className={styles.qualityHeading}>Quality points</h3>
					<ul className={styles.qualityList}>
						{pass.qualityPoints.map((point) => (
							<li key={point}>{point}</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
