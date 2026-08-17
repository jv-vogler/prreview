import { SparkleFillIcon } from "@primer/octicons-react";
import { useFeatureFlags } from "../session/useFeatureFlags";
import { useAnalysis } from "./AnalysisProvider";
import styles from "./AnalyzeMenu.module.css";

/** what the one M2 analysis task does, in the reader's terms (F3, F4, F5) */
const EXPLAIN_LABEL = "Explain this change";

/**
 * The trigger for the analysis lane. One action in this milestone, so it is one
 * button rather than a menu — M3 adds findings and re-analysis lenses next to it.
 *
 * Absent, not disabled, when this session has no agent (F12): a control that can
 * never work is worse than no control, and `ViewerOnlyNotice` is the one place
 * that explains why. While a run is going the button is disabled and the tray
 * below the header carries the state, so the header never becomes a status line.
 */
export function AnalyzeMenu() {
	const flags = useFeatureFlags();
	const analysis = useAnalysis();

	if (!flags.analysis) {
		return null;
	}

	const conflictRunId = analysis.conflictRunId;
	if (conflictRunId !== null) {
		return (
			<button
				type="button"
				className={styles.analyze}
				onClick={() => analysis.cancelAndRestart(conflictRunId)}
			>
				<SparkleFillIcon size={16} />
				Cancel and re-run
			</button>
		);
	}

	const busy = analysis.starting || analysis.activeRun !== null;

	return (
		<button
			type="button"
			className={styles.analyze}
			onClick={() => analysis.startAnalysis()}
			disabled={busy}
		>
			<SparkleFillIcon size={16} />
			{busy ? "Explaining…" : EXPLAIN_LABEL}
		</button>
	);
}
