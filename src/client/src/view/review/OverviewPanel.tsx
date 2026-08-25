import type { ReviewPassDto } from "@dto/ReviewDto";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./OverviewPanel.module.css";

/**
 * The pass's lede, above the diff (TASK-042, REQ-003): the business-level
 * prose first, then the verdict as the closing line under it, colored by
 * the scope check's outcome so the conclusion reads at a glance. Read once,
 * then scrolled past — this does not get a sidebar of its own.
 *
 * The overview is markdown, not text. The agent writes paragraphs separated
 * by blank lines and backticks around names worth going to look for, and
 * without a renderer both arrive as literal characters in a single wall.
 */
export function OverviewPanel({ pass }: { pass: ReviewPassDto }) {
	return (
		<div className={styles.panel}>
			<div className={styles.body}>
				<div className={styles.prose}>
					<Markdown remarkPlugins={[remarkGfm]}>{pass.overview}</Markdown>
				</div>
				{pass.ticket !== null && (
					<aside className={styles.ticket}>
						<h2 className={styles.label}>Ticket</h2>
						<p className={styles.ticketText}>{pass.ticket}</p>
					</aside>
				)}
			</div>
			<div className={styles.verdictRow}>
				<h2 className={styles.verdictLabel}>Verdict</h2>
				<p className={styles.verdict} data-scope={pass.scope ?? "neutral"}>
					{pass.verdict}
				</p>
			</div>
		</div>
	);
}
