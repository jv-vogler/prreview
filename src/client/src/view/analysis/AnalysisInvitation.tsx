import type { ReactNode } from "react";
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
	/**
	 * Anything the caller needs above the button — the findings pass puts its
	 * depth choice here.
	 *
	 * A slot rather than a `task === "review"` branch, because this component is
	 * shared with the Understanding tab and it has no business knowing what a
	 * lens is. Branching on the task inside here is how one shared component
	 * ends up holding both tabs' vocabularies.
	 */
	controls?: ReactNode;
	/** replaces the default trigger, for a caller that has options to pass */
	onAction?(): void;
}

export function AnalysisInvitation({
	title,
	body,
	cost,
	actionLabel,
	task = "comprehension",
	controls,
	onAction,
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
			{controls}
			<button
				type="button"
				className={styles.action}
				onClick={() => {
					if (onAction !== undefined) {
						onAction();
						return;
					}
					if (task === "review") {
						analysis.startReview();
						return;
					}
					analysis.startAnalysis();
				}}
				disabled={running}
				data-analysis-start
			>
				{running ? "Running…" : actionLabel}
			</button>
			{/*
				No failure text here on purpose. It used to be the only place a
				failure was reported, which meant a run that died while the reader
				was on another tab said nothing anywhere. RunStatusBar sits in the
				layout and reports it wherever they are; repeating it here would be
				the same sentence twice on one screen.
			*/}
		</div>
	);
}
