import styles from "./AnalysisInvitation.module.css";
import { useAnalysis } from "./AnalysisProvider";

/**
 * What a tab shows when the pass that fills it has not been run.
 *
 * The invitation **states its own cost** and triggers exactly one pass. Nothing
 * here chains a second one: a reader who wants understanding gets understanding
 * and is not quietly billed for a review they did not ask for. That restraint
 * is the reason each capability has its own button rather than one "analyze"
 * that does everything.
 */

export interface AnalysisInvitationProps {
	title: string;
	body: string;
	/** honest units, never a dollar figure — see the note below */
	cost: string;
	actionLabel: string;
	/** which pass this invitation triggers; they are never chained */
	task?: "comprehension" | "review";
}

export function AnalysisInvitation({
	title,
	body,
	cost,
	actionLabel,
	task = "comprehension",
}: AnalysisInvitationProps) {
	const analysis = useAnalysis();
	const running = analysis.activeRun !== null || analysis.starting;

	return (
		<div className={styles.invitation}>
			<h2 className={styles.title}>{title}</h2>
			<p className={styles.body}>{body}</p>
			{/*
				Cost is quoted in units prreview can actually observe — passes, the
				size of what is sent, the turn ceiling. Never a dollar figure: there
				is no --model flag, the backend may be Bedrock, Vertex, or a
				subscription, and a confident "$0.12" that turns out wrong is worse
				than saying what is actually known.
			*/}
			<p className={styles.cost}>{cost}</p>
			<button
				type="button"
				className={styles.action}
				onClick={() =>
					task === "review" ? analysis.startReview() : analysis.startAnalysis()
				}
				disabled={running}
				data-analysis-start
			>
				{running ? "Running…" : actionLabel}
			</button>
			{analysis.failure !== null && (
				<p className={styles.failure} role="alert">
					{analysis.failure.message}
				</p>
			)}
		</div>
	);
}
