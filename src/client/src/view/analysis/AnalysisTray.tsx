import type { RunDto } from "@dto/RunDto";
import { AlertIcon } from "@primer/octicons-react";
import { useFeatureFlags } from "../session/useFeatureFlags";
import { useAnalysis } from "./AnalysisProvider";
import styles from "./AnalysisTray.module.css";
import { ANALYSIS_FAILURE_COPY } from "./analysisFailureCopy";
import { formatElapsed } from "./formatElapsed";
import { useElapsedSince } from "./useElapsedSince";

/**
 * What the reader is waiting for, per lifecycle state (ARCHITECTURE §7). Only
 * `queued` and `running` can reach this row — a settled run is no longer the
 * active one — but the record is exhaustive so a status can never render blank.
 */
const RUN_LABEL: Record<RunDto["status"], string> = {
	queued: "Waiting for the agent",
	running: "Reading the change",
	succeeded: "Finished",
	failed: "The analysis failed",
	cancelled: "Stopped",
	"timed-out": "The analysis ran out of time",
};

/**
 * What the analysis lane is doing right now, and what went wrong when it stops.
 *
 * Present only while there is something to say: a run in flight, or a failure
 * the reader has not yet answered. A finished run leaves no banner behind —
 * the notes in the margin and the orientation link are the result, and a
 * self-congratulating strip would only have to be dismissed.
 */
export function AnalysisTray() {
	const flags = useFeatureFlags();
	const analysis = useAnalysis();

	if (!flags.analysis) {
		return null;
	}
	if (analysis.activeRun !== null) {
		return (
			<RunningRow run={analysis.activeRun} onCancel={analysis.cancelRun} />
		);
	}
	if (analysis.failure !== null) {
		return (
			<div className={styles.tray} data-state="failed" role="alert">
				<span className={styles.icon}>
					<AlertIcon size={16} />
				</span>
				<span className={styles.message}>
					{ANALYSIS_FAILURE_COPY[analysis.failure.reason]}
				</span>
				<button
					type="button"
					className={styles.action}
					onClick={() => analysis.startAnalysis()}
				>
					Try again
				</button>
			</div>
		);
	}
	return null;
}

interface RunningRowProps {
	run: RunDto;
	onCancel(runId: string): void;
}

function RunningRow({ run, onCancel }: RunningRowProps) {
	const elapsedMs = useElapsedSince(run.startedAt ?? run.queuedAt);

	return (
		<div className={styles.tray} data-state="running" role="status">
			<span className={styles.spinner} aria-hidden="true" />
			<span className={styles.message}>
				{RUN_LABEL[run.status]}
				{elapsedMs !== null && (
					<span className={styles.elapsed}>{formatElapsed(elapsedMs)}</span>
				)}
			</span>
			<button
				type="button"
				className={styles.action}
				onClick={() => onCancel(run.id)}
			>
				Stop
			</button>
		</div>
	);
}
