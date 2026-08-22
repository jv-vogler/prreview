import type { ReviewPassDto } from "@dto/ReviewDto";
import styles from "./OverviewPanel.module.css";

/**
 * The pass's own overview, above the diff (TASK-042, REQ-003): business-level
 * prose, the verdict and the ticket line. Read once, then scrolled past — it
 * does not get a sidebar of its own.
 */
export function OverviewPanel({ pass }: { pass: ReviewPassDto }) {
	return (
		<div className={styles.panel}>
			<p className={styles.overview}>{pass.overview}</p>
			<p className={styles.verdict}>{pass.verdict}</p>
			{pass.ticket !== null && <p className={styles.ticket}>{pass.ticket}</p>}
		</div>
	);
}
