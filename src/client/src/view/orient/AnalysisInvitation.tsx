import { AnalyzeMenu } from "../analysis/AnalyzeMenu";
import styles from "./AnalysisInvitation.module.css";

/**
 * The orientation page before any analysis has run. It says what prreview would
 * do, what it costs, and who is in control — analysis never starts on its own
 * (REQ-003), and it spends the reader's own agent account (RISK-009), so both
 * facts belong here rather than in a footnote.
 */
export function AnalysisInvitation() {
	return (
		<div className={styles.invitation}>
			<p className={styles.lead}>prreview has not read this change yet.</p>
			<p className={styles.body}>
				One pass with the <code className={styles.code}>claude</code> CLI
				already on this machine gives you what the change is for, how it breaks
				down, where to start reading, and notes in the margin of the diff. It
				runs on your own agent account, and only when you ask.
			</p>
			<AnalyzeMenu />
		</div>
	);
}
