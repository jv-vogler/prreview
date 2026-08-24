import type { ReviewPassDto } from "@dto/ReviewDto";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./OverviewPanel.module.css";

/**
 * The pass's lede, above the diff (TASK-042, REQ-003). The verdict leads
 * because it is the one line a reviewer opens the page for; the business-level
 * prose and the ticket note follow it. Read once, then scrolled past — this
 * does not get a sidebar of its own.
 *
 * The overview is markdown, not text. The agent writes paragraphs separated
 * by blank lines and backticks around names worth going to look for, and
 * without a renderer both arrive as literal characters in a single wall.
 */
export function OverviewPanel({ pass }: { pass: ReviewPassDto }) {
	return (
		<div className={styles.panel}>
			<div className={styles.lede}>
				<h2 className={styles.label}>Verdict</h2>
				<p className={styles.verdict}>{pass.verdict}</p>
			</div>
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
		</div>
	);
}
